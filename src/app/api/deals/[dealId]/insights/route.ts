import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveDealInsights, type InsightInput } from "@/lib/intelligence/insights/deriveDealInsights";
import { deriveAutoIntelligenceState } from "@/lib/intelligence/auto/deriveAutoIntelligenceState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/insights
 *
 * Synthesized deal insight from existing system outputs.
 * Read-only — no new orchestration or persistence.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const sb = supabaseAdmin();

  // Load all sources in parallel
  const [
    intelligenceRunRes,
    intelligenceStepsRes,
    snapshotRes,
    riskPricingRes,
    lenderMatchRes,
    lifecycleRes,
    blockerRes,
  ] = await Promise.all([
    sb.from("deal_intelligence_runs").select("id, status").eq("deal_id", dealId).order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("deal_intelligence_steps").select("step_code, status, summary, error_detail")
      .eq("deal_id", dealId).order("step_code"),
    sb.from("deal_truth_snapshots").select("id, snapshot_json").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("deal_risk_pricing_model").select("finalized, risk_grade, risk_score").eq("deal_id", dealId).maybeSingle(),
    sb.from("deal_lender_matches" as any).select("id").eq("deal_id", dealId),
    sb.from("deals").select("stage").eq("id", dealId).maybeSingle(),
    sb.from("deal_pipeline_ledger").select("event_key, ui_message").eq("deal_id", dealId).eq("event_key", "lifecycle.blocker").order("created_at", { ascending: false }).limit(10),
  ]);

  // Derive intelligence state
  const intelState = deriveAutoIntelligenceState(
    intelligenceRunRes.data,
    (intelligenceStepsRes.data ?? []).map((s: any) => ({
      step_code: s.step_code, status: s.status, summary: s.summary ?? {}, error_detail: s.error_detail,
    })),
  );

  // Extract snapshot narrative
  const snapshotJson = (snapshotRes.data as any)?.snapshot_json;
  const snapshotNarrative = snapshotJson ? {
    executiveSummary: snapshotJson?.executive_summary ?? snapshotJson?.executiveSummary ?? null,
    risks: Array.isArray(snapshotJson?.risks) ? snapshotJson.risks : [],
    mitigants: Array.isArray(snapshotJson?.mitigants) ? snapshotJson.mitigants : [],
    recommendation: snapshotJson?.recommendation ?? snapshotJson?.verdict ?? null,
  } : null;

  // Build lifecycle blockers from derived state
  // For now, use a simplified approach
  const lifecycleBlockers: Array<{ code: string; message: string }> = [];

  // Build insight input
  const insightInput: InsightInput = {
    dealId,
    intelligenceRunning: intelState.pipelineRunning,
    intelligenceReady: intelState.pipelineReady,
    snapshotExists: Boolean(snapshotRes.data),
    snapshotNarrative,
    riskPricingExists: Boolean(riskPricingRes.data),
    riskPricingFinalized: (riskPricingRes.data as any)?.finalized === true,
    riskGrade: (riskPricingRes.data as any)?.risk_grade ?? null,
    riskScore: (riskPricingRes.data as any)?.risk_score != null ? Number((riskPricingRes.data as any).risk_score) : null,
    lenderMatchCount: (lenderMatchRes.data ?? []).length,
    lenderMatchReady: (lenderMatchRes.data ?? []).length > 0,
    lifecycleStage: (lifecycleRes.data as any)?.stage ?? null,
    lifecycleBlockers,
    lifecycleNextAction: null, // Will be populated from lifecycle derivation in future
  };

  const insight = deriveDealInsights(insightInput);

  return NextResponse.json({ ok: true, dealId, insight });
}
