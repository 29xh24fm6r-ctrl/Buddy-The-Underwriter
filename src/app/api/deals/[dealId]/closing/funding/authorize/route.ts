import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFundingAuthorizationGate } from "@/lib/closing/getFundingAuthorizationGate";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/closing/funding/authorize
 * Authorize funding release. Requires execution_complete.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const gate = await getFundingAuthorizationGate(dealId);

  if (!gate.executionComplete) {
    return NextResponse.json({ ok: false, error: "execution_not_complete", reasons: gate.reasons }, { status: 422 });
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // Find execution run
  const { data: run } = await sb.from("closing_execution_runs").select("id")
    .eq("closing_package_id", gate.activePackageId!).maybeSingle();

  if (!run) return NextResponse.json({ ok: false, error: "No execution run" }, { status: 404 });

  const { data: funding } = await sb.from("funding_authorizations").insert({
    deal_id: dealId,
    closing_package_id: gate.activePackageId!,
    closing_execution_run_id: run.id,
    status: "authorized",
    authorized_by: auth.userId,
    authorized_at: now,
  }).select("id").single();

  await logLedgerEvent({
    dealId, bankId: auth.bankId,
    eventKey: "closing.funding.authorized",
    uiState: "done",
    uiMessage: "Funding authorized",
    meta: { funding_id: funding?.id, actor: auth.userId },
  }).catch(() => {});

  return NextResponse.json({ ok: true, fundingAuthorizationId: funding?.id });
}
