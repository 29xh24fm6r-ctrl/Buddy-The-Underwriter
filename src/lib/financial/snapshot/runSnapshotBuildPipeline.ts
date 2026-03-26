import "server-only";

/**
 * Phase 55B — Snapshot Build Pipeline Orchestrator
 *
 * Collects normalized financial facts, builds snapshot, persists,
 * promotes to active, and evaluates readiness. Called from the real
 * extraction/spread pipeline on material financial changes.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildFinancialSnapshot } from "./buildFinancialSnapshot";
import { evaluateSnapshotReadiness } from "./evaluateSnapshotReadiness";
import { promoteFinancialSnapshot } from "./promoteFinancialSnapshot";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { FinancialSnapshotStatus } from "./types";

type PipelineInput = {
  dealId: string;
  bankId: string;
  triggerSource: string;
  extractedFacts: Array<{
    metricKey: string;
    metricLabel: string;
    periodKey: string;
    entityKey?: string | null;
    numericValue?: number | null;
    textValue?: string | null;
    unit?: string | null;
    confidence: number | null;
    documentId: string | null;
    extractedField?: string | null;
    spreadLineRef?: string | null;
  }>;
  requiredMetricKeys: string[];
};

type PipelineResult = {
  ok: true;
  snapshotId: string;
  status: FinancialSnapshotStatus;
  promoted: boolean;
  factCount: number;
  missingCount: number;
  conflictCount: number;
} | {
  ok: false;
  error: string;
};

/**
 * Run the full snapshot build + persist + promote pipeline.
 */
export async function runSnapshotBuildPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { dealId, bankId, triggerSource, extractedFacts, requiredMetricKeys } = input;
  const sb = supabaseAdmin();

  try {
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "financial_snapshot.build_triggered",
      uiState: "working",
      uiMessage: "Financial snapshot build started",
      meta: { trigger_source: triggerSource, fact_count: extractedFacts.length },
    }).catch(() => {});

    // 1. Build snapshot candidate
    const buildResult = buildFinancialSnapshot({
      dealId,
      bankId,
      extractedFacts,
      requiredMetricKeys,
    });

    // 2. Persist snapshot
    const { data: snapshotRow, error: snapErr } = await sb
      .from("financial_snapshots_v2")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        status: buildResult.recommendedStatus,
        active: false, // promoted separately
        period_start: buildResult.snapshot.periodStart,
        period_end: buildResult.snapshot.periodEnd,
        entity_scope: buildResult.snapshot.entityScope,
        source_document_count: buildResult.snapshot.sourceDocumentCount,
        material_fact_count: buildResult.snapshot.materialFactCount,
        validated_fact_count: buildResult.snapshot.validatedFactCount,
        unresolved_conflict_count: buildResult.snapshot.unresolvedConflictCount,
        missing_fact_count: buildResult.snapshot.missingFactCount,
      })
      .select("id")
      .single();

    if (snapErr || !snapshotRow) {
      throw new Error(`Snapshot insert failed: ${snapErr?.message ?? "no row"}`);
    }

    const snapshotId = snapshotRow.id;

    // 3. Persist facts
    if (buildResult.facts.length > 0) {
      const factRows = buildResult.facts.map((f) => ({
        snapshot_id: snapshotId,
        deal_id: dealId,
        metric_key: f.metricKey,
        metric_label: f.metricLabel,
        period_key: f.periodKey,
        entity_key: f.entityKey,
        numeric_value: f.numericValue,
        text_value: f.textValue,
        unit: f.unit,
        extraction_confidence: f.extractionConfidence,
        validation_state: f.validationState,
        conflict_state: f.conflictState,
        primary_document_id: f.primaryDocumentId,
        provenance: f.provenance,
      }));

      const { error: factErr } = await sb
        .from("financial_snapshot_facts")
        .insert(factRows);

      if (factErr) {
        console.error("[runSnapshotBuildPipeline] Fact insert error (non-fatal)", { error: factErr.message });
      }
    }

    // 4. Promote to active
    const promotion = await promoteFinancialSnapshot({
      dealId,
      bankId,
      newSnapshotId: snapshotId,
      newStatus: buildResult.recommendedStatus,
    });

    // 5. Log completion
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "financial_snapshot.built",
      uiState: "done",
      uiMessage: "Financial snapshot built",
      meta: {
        snapshot_id: snapshotId,
        status: buildResult.recommendedStatus,
        promoted: promotion.promoted,
        fact_count: buildResult.facts.length,
        missing_count: buildResult.missingKeys.length,
        conflict_count: buildResult.conflicts.length,
      },
    }).catch(() => {});

    return {
      ok: true,
      snapshotId,
      status: buildResult.recommendedStatus,
      promoted: promotion.promoted,
      factCount: buildResult.facts.length,
      missingCount: buildResult.missingKeys.length,
      conflictCount: buildResult.conflicts.length,
    };
  } catch (err) {
    console.error("[runSnapshotBuildPipeline] Failed", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
