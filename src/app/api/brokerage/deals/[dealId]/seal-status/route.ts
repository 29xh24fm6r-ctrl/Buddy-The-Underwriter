import "server-only";

/**
 * GET /api/brokerage/deals/[dealId]/seal-status
 *
 * Borrower-facing status endpoint. Returns seal gate reasons (so the UI
 * can show what's still blocking), plus current listing state if sealed.
 *
 * Session must match the URL's dealId per the same 404-not-403 rule as
 * other brokerage routes.
 *
 * NOTE: Sprint 5 spec mentioned this route but truncated before the
 * handler body. Implemented from session/scope pattern used by
 * /api/brokerage/deals/[dealId]/seal and /trident/download/[kind] to
 * stay consistent with prior sprints — flag for eyeball pass.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { canSeal } from "@/lib/brokerage/sealingGate";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const sb = supabaseAdmin();

  // Current active listing if one exists.
  const { data: listing } = await sb
    .from("marketplace_listings")
    .select(
      "id, status, score, band, published_rate_bps, preview_opens_at, claim_opens_at, claim_closes_at, matched_lender_bank_ids",
    )
    .eq("deal_id", dealId)
    .not("status", "eq", "expired")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Gate evaluation (even when already sealed — surfaces re-seal readiness).
  const gate = await canSeal(dealId, sb);

  if (listing) {
    const row = listing as any;
    return NextResponse.json({
      ok: true,
      sealed: true,
      listing: {
        id: row.id,
        status: row.status,
        score: row.score,
        band: row.band,
        publishedRateBps: row.published_rate_bps,
        previewOpensAt: row.preview_opens_at,
        claimOpensAt: row.claim_opens_at,
        claimClosesAt: row.claim_closes_at,
        matchedLenderCount: Array.isArray(row.matched_lender_bank_ids)
          ? row.matched_lender_bank_ids.length
          : 0,
      },
      canSeal: gate.ok,
      gateReasons: gate.ok ? [] : gate.reasons,
    });
  }

  return NextResponse.json({
    ok: true,
    sealed: false,
    canSeal: gate.ok,
    gateReasons: gate.ok ? [] : gate.reasons,
  });
}
