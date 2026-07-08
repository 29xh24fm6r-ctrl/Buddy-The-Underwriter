import "server-only";

/**
 * GET /api/lender/marketplace/listings
 *
 * The lender-facing marketplace feed. Returns the redacted KFS for every open
 * listing this lender is matched to, plus whether they've already claimed it.
 * route-class: CLERK (lender — resolved via resolveLenderIdentity, 403 otherwise).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveLenderIdentity } from "@/lib/brokerage/lenderAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const lender = await resolveLenderIdentity();
  if (!lender) {
    return NextResponse.json({ ok: false, error: "not_a_lender" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: listings, error } = await sb
    .from("marketplace_listings")
    .select(
      "id, kfs, score, band, published_rate_bps, sba_program, loan_amount, term_months, status, claim_opens_at, claim_closes_at",
    )
    .contains("matched_lender_bank_ids", [lender.lenderBankId])
    .in("status", ["claiming", "awaiting_borrower_pick"])
    .lte("preview_opens_at", nowIso)
    .gt("claim_closes_at", nowIso)
    .order("claim_closes_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = (listings ?? []).map((l: any) => l.id);
  const claimedByYou = new Set<string>();
  if (ids.length) {
    const { data: claims } = await sb
      .from("marketplace_claims")
      .select("listing_id")
      .eq("lender_bank_id", lender.lenderBankId)
      .in("listing_id", ids)
      .eq("status", "active");
    for (const c of (claims ?? []) as any[]) claimedByYou.add(c.listing_id);
  }

  return NextResponse.json({
    ok: true,
    listings: (listings ?? []).map((l: any) => ({
      ...l,
      claimedByYou: claimedByYou.has(l.id),
    })),
  });
}
