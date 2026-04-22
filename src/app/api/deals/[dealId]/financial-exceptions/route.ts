import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildFinancialExceptions } from "@/lib/financialValidation/buildFinancialExceptions";
import { buildOverrideInsights } from "@/lib/financialValidation/buildOverrideInsights";
import { getFinancialSnapshotGate } from "@/lib/financial/snapshot/getFinancialSnapshotGate";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/financial-exceptions
 *
 * Returns classified financial exceptions with severity, narrative,
 * override insights, and committee disclosure flags.
 * Auth: Clerk session + deal cockpit access.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const sb = supabaseAdmin();

  // Load data in parallel
  const [gapsRes, resolutionsRes, gate] = await Promise.all([
    sb.from("deal_gap_queue")
      .select("id, gap_type, fact_key, fact_id, status, description")
      .eq("deal_id", dealId),
    sb.from("financial_review_resolutions")
      .select("id, gap_id, action, fact_key, prior_value, resolved_value, rationale, resolved_at")
      .eq("deal_id", dealId)
      .order("resolved_at", { ascending: false }),
    getFinancialSnapshotGate(dealId),
  ]);

  const gaps = (gapsRes.data ?? []).map((g: any) => ({
    id: g.id,
    gapType: g.gap_type,
    factKey: g.fact_key,
    factId: g.fact_id,
    status: g.status,
    description: g.description ?? "",
  }));

  const resolutions = (resolutionsRes.data ?? []).map((r: any) => ({
    id: r.id,
    gapId: r.gap_id,
    action: r.action,
    factKey: r.fact_key ?? "",
    priorValue: r.prior_value != null ? Number(r.prior_value) : null,
    resolvedValue: r.resolved_value != null ? Number(r.resolved_value) : null,
    rationale: r.rationale,
    resolvedAt: r.resolved_at,
  }));

  const exceptions = buildFinancialExceptions({
    dealId,
    gaps,
    resolutions,
    snapshotStale: gate.blockerCode === "financial_snapshot_stale",
    isPostMemo: false, // Caller can set based on memo state
    materialChangesAfterMemo: [],
  });

  const overrideInsights = buildOverrideInsights(
    resolutions.map((r) => ({
      factKey: r.factKey,
      periodKey: null,
      action: r.action,
      priorValue: r.priorValue,
      resolvedValue: r.resolvedValue,
      rationale: r.rationale,
    })),
  );

  const summary = {
    openCritical: exceptions.filter((e) => e.status === "open" && e.severity === "critical").length,
    openHigh: exceptions.filter((e) => e.status === "open" && e.severity === "high").length,
    openModerate: exceptions.filter((e) => e.status === "open" && e.severity === "moderate").length,
    overrideCount: overrideInsights.length,
    disclosureRequired: overrideInsights.some((o) => o.requiresCommitteeDisclosure) ||
      exceptions.some((e) => e.committeeDisclosure != null),
    recommendedAction: exceptions.find((e) => e.status === "open")?.recommendedAction ?? null,
  };

  return NextResponse.json({ ok: true, summary, exceptions, overrideInsights });
}
