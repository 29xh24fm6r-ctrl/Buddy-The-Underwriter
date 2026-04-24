import "server-only";

/**
 * GET /api/deals/[dealId]/buddy-sba-score/history
 *
 * Returns every Buddy SBA Score computed for the deal, newest first.
 * Includes superseded + locked + draft. Used by the audit trail UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/server/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  try {
    await requireDealAccess(dealId);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const status =
      e?.name === "AuthenticationRequiredError" ? 401 :
      e?.name === "DealAccessDeniedError" ? 404 :
      e?.name === "BankMembershipRequiredError" ? 403 :
      500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_sba_scores")
    .select("*")
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: data ?? [] });
}
