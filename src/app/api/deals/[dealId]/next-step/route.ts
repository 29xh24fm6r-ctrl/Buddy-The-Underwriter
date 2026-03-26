import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getDealNextStep } from "@/lib/dealCommandCenter/getDealNextStep";
import { getFinancialSnapshotGate } from "@/lib/financial/snapshot/getFinancialSnapshotGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/next-step
 *
 * Returns the deterministic current next step for a deal.
 * Auth: Clerk session + deal cockpit access.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const sb = supabaseAdmin();
    const gate = await getFinancialSnapshotGate(dealId);

    const [actionsRes, conditionsRes, covenantsRes, monitoringRes] = await Promise.all([
      sb.from("credit_action_recommendations").select("id, status, action_type").eq("deal_id", dealId),
      sb.from("deal_conditions").select("id, status").eq("deal_id", dealId).eq("status", "open"),
      sb.from("deal_covenants").select("id").eq("deal_id", dealId).eq("status", "proposed"),
      sb.from("deal_monitoring_seeds").select("id").eq("deal_id", dealId).eq("status", "seeded"),
    ]);

    const actions = actionsRes.data ?? [];
    const unexecuted = actions.filter((a: any) => a.status === "accepted").length;
    const pricingOpen = actions.some((a: any) => a.action_type === "pricing_review" && a.status === "proposed");
    const structureOpen = actions.some((a: any) => a.action_type === "structure_review" && a.status === "proposed");
    const memoRegen = actions.some((a: any) => a.action_type === "memo_regeneration_required" && a.status !== "implemented");
    const packetRegen = actions.some((a: any) => a.action_type === "packet_regeneration_required" && a.status !== "implemented");
    const committeeOpen = actions.filter((a: any) => a.action_type === "committee_discussion_item" && a.status === "proposed").length;

    const nextStep = getDealNextStep({
      dealId,
      stage: null,
      blockers: [],
      unexecutedActionCount: unexecuted,
      pendingBorrowerRequests: (conditionsRes.data ?? []).length,
      pricingReviewOpen: pricingOpen,
      structureReviewOpen: structureOpen,
      memoRegenerationRequired: memoRegen,
      packetRegenerationRequired: packetRegen,
      committeeDiscussionOpen: committeeOpen,
      covenantSeedsCount: (covenantsRes.data ?? []).length,
      monitoringSeedsCount: (monitoringRes.data ?? []).length,
      financialValidationBlocked: !gate.ready,
    });

    return NextResponse.json({ ok: true, nextStep });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Failed" }, { status: 500 });
  }
}
