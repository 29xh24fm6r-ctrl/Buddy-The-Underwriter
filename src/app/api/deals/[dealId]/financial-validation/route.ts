import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateSnapshotReadiness } from "@/lib/financial/snapshot/evaluateSnapshotReadiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/financial-validation
 *
 * Returns the active financial snapshot with facts, readiness, and completeness.
 * Auth: Clerk session + deal cockpit access.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const sb = supabaseAdmin();

  const { data: snapshot } = await sb
    .from("financial_snapshots_v2")
    .select("*")
    .eq("deal_id", dealId)
    .eq("active", true)
    .maybeSingle();

  if (!snapshot) {
    return NextResponse.json({
      ok: true,
      snapshot: null,
      facts: [],
      readiness: {
        snapshotStatus: "not_started",
        completenessPercent: 0,
        criticalMissingFacts: [],
        unresolvedConflicts: [],
        staleReasons: [],
        reviewRequired: false,
        decisionSafe: false,
        memoSafe: false,
        nextRecommendedAction: "Upload financial documents to begin snapshot generation",
      },
    });
  }

  const { data: facts } = await sb
    .from("financial_snapshot_facts")
    .select("*")
    .eq("snapshot_id", snapshot.id)
    .order("metric_key")
    .order("period_key");

  const readiness = evaluateSnapshotReadiness({
    snapshotStatus: snapshot.status,
    facts: (facts ?? []).map((f: any) => ({
      ...f,
      snapshotId: f.snapshot_id,
      dealId: f.deal_id,
      metricKey: f.metric_key,
      metricLabel: f.metric_label,
      periodKey: f.period_key,
      entityKey: f.entity_key,
      numericValue: f.numeric_value,
      textValue: f.text_value,
      extractionConfidence: f.extraction_confidence,
      validationState: f.validation_state,
      conflictState: f.conflict_state,
      primaryDocumentId: f.primary_document_id,
      provenance: f.provenance ?? [],
      reviewerUserId: f.reviewer_user_id,
      reviewerRationale: f.reviewer_rationale,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    })),
    requiredMetricKeys: [], // Populated from metric registry in production
  });

  return NextResponse.json({ ok: true, snapshot, facts: facts ?? [], readiness });
}
