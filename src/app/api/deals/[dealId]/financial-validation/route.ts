import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateSnapshotReadiness } from "@/lib/financial/snapshot/evaluateSnapshotReadiness";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
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
    // SPEC-CURRENT-STAGE-AUDIT-FIX-2: the v2 snapshot pipeline (runSnapshotBuildPipeline →
    // financial_snapshots_v2) has no production caller, so this surface reported "not_started" for
    // EVERY deal — even fully-spread ones. The recompute path writes the v1 table financial_snapshots
    // (whose snapshot_json already carries completeness_pct + missing_required_keys). Fall back to v1
    // so the validation surface reflects reality, mirroring getFinancialSnapshotGate's v1 fallback.
    const { data: v1 } = await sb
      .from("financial_snapshots")
      .select("id, snapshot_json, snapshot_hash, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (v1 && (v1 as any).snapshot_json && typeof (v1 as any).snapshot_json === "object") {
      const s = (v1 as any).snapshot_json as Record<string, any>;
      const completeness = Number(s.completeness_pct ?? 0);
      const missing = Array.isArray(s.missing_required_keys) ? s.missing_required_keys : [];
      const ready = missing.length === 0 && completeness >= 99.9;
      return NextResponse.json({
        ok: true,
        source: "v1_fallback",
        snapshot: {
          id: (v1 as any).id,
          status: ready ? "ready" : "partial",
          created_at: (v1 as any).created_at,
          snapshot_hash: (v1 as any).snapshot_hash,
          snapshot_json: s,
        },
        facts: [],
        readiness: {
          snapshotStatus: ready ? "ready" : "partial",
          completenessPercent: Math.round(completeness),
          criticalMissingFacts: missing,
          unresolvedConflicts: [],
          staleReasons: [],
          reviewRequired: !ready,
          decisionSafe: ready,
          memoSafe: ready,
          nextRecommendedAction: ready
            ? "Financial snapshot complete."
            : `Resolve ${missing.length} missing required fact(s) to complete the snapshot.`,
        },
      });
    }

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
