import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildFinancialExceptions } from "@/lib/financialValidation/buildFinancialExceptions";
import { buildOverrideInsights } from "@/lib/financialValidation/buildOverrideInsights";
import { buildCreditActionRecommendations } from "@/lib/creditActioning/buildCreditActionRecommendations";
import { getFinancialSnapshotGate } from "@/lib/financial/snapshot/getFinancialSnapshotGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/credit-actions
 *
 * Returns credit action recommendations derived from exception intelligence.
 * Auth: Clerk session + deal cockpit access.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const sb = supabaseAdmin();

  const [gapsRes, resolutionsRes, gate] = await Promise.all([
    sb.from("deal_gap_queue").select("id, gap_type, fact_key, fact_id, status, description").eq("deal_id", dealId),
    sb.from("financial_review_resolutions").select("id, gap_id, action, fact_key, prior_value, resolved_value, rationale, resolved_at").eq("deal_id", dealId),
    getFinancialSnapshotGate(dealId),
  ]);

  const gaps = (gapsRes.data ?? []).map((g: any) => ({
    id: g.id, gapType: g.gap_type, factKey: g.fact_key, factId: g.fact_id, status: g.status, description: g.description ?? "",
  }));

  const resolutions = (resolutionsRes.data ?? []).map((r: any) => ({
    id: r.id, gapId: r.gap_id, action: r.action, factKey: r.fact_key ?? "",
    priorValue: r.prior_value != null ? Number(r.prior_value) : null,
    resolvedValue: r.resolved_value != null ? Number(r.resolved_value) : null,
    rationale: r.rationale, resolvedAt: r.resolved_at,
  }));

  const exceptions = buildFinancialExceptions({
    dealId, gaps, resolutions,
    snapshotStale: gate.blockerCode === "financial_snapshot_stale",
    isPostMemo: false, materialChangesAfterMemo: [],
  });

  const overrideInsights = buildOverrideInsights(
    resolutions.map((r) => ({ factKey: r.factKey, periodKey: null, action: r.action, priorValue: r.priorValue, resolvedValue: r.resolvedValue, rationale: r.rationale })),
  );

  const recommendations = buildCreditActionRecommendations({
    dealId, exceptions, overrideInsights, isPreCommittee: true, isPostMemo: false,
  });

  const summary = {
    immediate: recommendations.filter((r) => r.priority === "immediate").length,
    preCommittee: recommendations.filter((r) => r.priority === "pre_committee").length,
    preClose: recommendations.filter((r) => r.priority === "pre_close").length,
    postClose: recommendations.filter((r) => r.priority === "post_close").length,
    pricingReviewOpen: recommendations.some((r) => r.actionType === "pricing_review" && r.status === "proposed"),
    structureReviewOpen: recommendations.some((r) => r.actionType === "structure_review" && r.status === "proposed"),
    committeeDiscussionOpen: recommendations.filter((r) => r.actionType === "committee_discussion_item" && r.status === "proposed").length,
  };

  return NextResponse.json({ ok: true, summary, recommendations });
}
