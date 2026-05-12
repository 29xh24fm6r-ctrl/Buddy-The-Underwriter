import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { classifyMarketplaceError } from "@/lib/brokerage/marketplaceClaimErrors";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/[token]/pick
 *
 * Borrower picks the winning lender. Atomic via pick_marketplace_winner():
 *   - Winning claim => won
 *   - Other active claims => lost
 *   - Listing.status => picked
 *   - Inserts marketplace_borrower_picks row
 *
 * The HTTP-only session cookie (hashed in DB) authenticates the borrower.
 * The {token} URL param exists for tenancy/UX symmetry; the cookie is the
 * actual proof.
 */
export async function POST(
  req: NextRequest,
  _ctx: { params: Promise<{ token: string }> },
) {
  const session = await getBorrowerSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  let body: { listing_id?: string; winning_lender_bank_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body.listing_id || !body.winning_lender_bank_id) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Verify listing belongs to the borrower's deal.
  const { data: listing, error: listingErr } = await sb
    .from("marketplace_listings")
    .select("id, deal_id")
    .eq("id", body.listing_id)
    .maybeSingle();

  if (listingErr || !listing) {
    return NextResponse.json({ ok: false, error: "listing_not_found" }, { status: 404 });
  }

  if (listing.deal_id !== session.deal_id) {
    return NextResponse.json(
      { ok: false, error: "listing_not_owned_by_borrower" },
      { status: 403 },
    );
  }

  const { data: pickId, error } = await sb.rpc("pick_marketplace_winner", {
    p_listing_id: body.listing_id,
    p_winning_lender_bank_id: body.winning_lender_bank_id,
  });

  if (error) {
    const { code, status } = classifyMarketplaceError(error.message);
    return NextResponse.json(
      { ok: false, error: code, detail: error.message },
      { status },
    );
  }

  return NextResponse.json({ ok: true, pick_id: pickId });
}
