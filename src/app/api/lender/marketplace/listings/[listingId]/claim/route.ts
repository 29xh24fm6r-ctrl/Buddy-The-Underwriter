import "server-only";

/**
 * POST /api/lender/marketplace/listings/[listingId]/claim
 *
 * A matched lender claims an open listing. Delegates to the claim_marketplace_listing
 * RPC (advisory-locked: validates the claim window + match, inserts the claim, flips
 * the listing to awaiting_borrower_pick). Queues the claim_confirmed lender message.
 * route-class: CLERK (lender).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveLenderIdentity } from "@/lib/brokerage/lenderAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RPC exceptions that are a conflict with listing/window state (409) vs a bad request (400).
const CONFLICT = new Set([
  "listing_not_found",
  "listing_not_claimable",
  "claim_window_not_open",
  "claim_window_closed",
  "lender_not_matched",
]);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<NextResponse> {
  const { listingId } = await params;
  const lender = await resolveLenderIdentity();
  if (!lender) {
    return NextResponse.json({ ok: false, error: "not_a_lender" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("claim_marketplace_listing", {
    p_listing_id: listingId,
    p_lender_bank_id: lender.lenderBankId,
  });

  if (error) {
    const reason = (error.message || "claim_failed").trim();
    const status = CONFLICT.has(reason) ? 409 : 400;
    return NextResponse.json({ ok: false, error: reason }, { status });
  }

  // Confirm to the lender (best-effort, non-fatal).
  try {
    const { queueLenderMessage } = await import("@/lib/brokerage/lenderComms");
    await queueLenderMessage(
      "claim_confirmed",
      {
        listingId,
        claimId: (data as any)?.claim_id,
        lenderBankId: lender.lenderBankId,
        stage: "claim",
      },
      "email",
      sb,
    );
  } catch (err) {
    console.warn("[marketplace/claim] claim_confirmed comms failed (non-fatal)", {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true, claim: data });
}
