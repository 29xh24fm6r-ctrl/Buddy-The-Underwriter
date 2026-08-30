import "server-only";

/**
 * GET /api/lender/marketplace/listings
 *
 * Returns only listings matched to the authenticated lender. Every
 * authoritative read is required evidence, and test-application exclusion is
 * evaluated against the deal ids returned by the listing query.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveLenderIdentityResult } from "@/lib/brokerage/lenderAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const CHUNK_SIZE = 100;

function json(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK_SIZE) {
    result.push(values.slice(index, index + CHUNK_SIZE));
  }
  return result;
}

export async function GET(): Promise<NextResponse> {
  const identity = await resolveLenderIdentityResult();
  if (!identity.ok) {
    if (identity.reason === "identity_state_unavailable") {
      return json({ ok: false, error: "lender_identity_unavailable" }, 503);
    }
    if (identity.reason === "ambiguous_lender_identity") {
      return json({ ok: false, error: "ambiguous_lender_identity" }, 409);
    }
    return json({ ok: false, error: "not_a_lender" }, 403);
  }

  const lender = identity.identity;
  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: listings, error: listingsError } = await sb
    .from("marketplace_listings")
    .select(
      "id, deal_id, kfs, score, band, published_rate_bps, sba_program, loan_amount, term_months, status, claim_opens_at, claim_closes_at",
    )
    .contains("matched_lender_bank_ids", [lender.lenderBankId])
    .in("status", ["claiming", "awaiting_borrower_pick"])
    .lte("preview_opens_at", nowIso)
    .gt("claim_closes_at", nowIso)
    .order("claim_closes_at", { ascending: true });

  if (listingsError || !Array.isArray(listings)) {
    return json({ ok: false, error: "marketplace_listings_unavailable" }, 503);
  }

  const listingRows = listings as Array<Record<string, unknown>>;
  const dealIds = Array.from(
    new Set(
      listingRows
        .map((row) => row.deal_id)
        .filter((value): value is string => typeof value === "string" && Boolean(value)),
    ),
  );
  if (dealIds.length !== new Set(listingRows.map((row) => row.deal_id)).size) {
    return json({ ok: false, error: "marketplace_listing_evidence_invalid" }, 503);
  }

  const testDealIds = new Set<string>();
  for (const dealIdChunk of chunks(dealIds)) {
    const { data, error } = await sb
      .from("deals")
      .select("id")
      .in("id", dealIdChunk)
      .eq("is_test", true);
    if (error || !Array.isArray(data)) {
      return json({ ok: false, error: "marketplace_isolation_unavailable" }, 503);
    }
    for (const row of data as Array<{ id?: unknown }>) {
      if (typeof row.id !== "string" || !dealIdChunk.includes(row.id)) {
        return json({ ok: false, error: "marketplace_isolation_evidence_invalid" }, 503);
      }
      testDealIds.add(row.id);
    }
  }

  const eligible = listingRows.filter(
    (row) => typeof row.deal_id === "string" && !testDealIds.has(row.deal_id),
  );
  const listingIds = eligible
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string" && Boolean(value));
  if (listingIds.length !== eligible.length) {
    return json({ ok: false, error: "marketplace_listing_evidence_invalid" }, 503);
  }

  const claimedByYou = new Set<string>();
  for (const listingIdChunk of chunks(listingIds)) {
    const { data, error } = await sb
      .from("marketplace_claims")
      .select("listing_id")
      .eq("lender_bank_id", lender.lenderBankId)
      .in("listing_id", listingIdChunk)
      .eq("status", "active");
    if (error || !Array.isArray(data)) {
      return json({ ok: false, error: "marketplace_claim_state_unavailable" }, 503);
    }
    for (const row of data as Array<{ listing_id?: unknown }>) {
      if (
        typeof row.listing_id !== "string" ||
        !listingIdChunk.includes(row.listing_id)
      ) {
        return json({ ok: false, error: "marketplace_claim_evidence_invalid" }, 503);
      }
      claimedByYou.add(row.listing_id);
    }
  }

  return json({
    ok: true,
    listings: eligible.map((row) => {
      const { deal_id: _dealId, ...publicListing } = row;
      return { ...publicListing, claimedByYou: claimedByYou.has(String(row.id)) };
    }),
  });
}
