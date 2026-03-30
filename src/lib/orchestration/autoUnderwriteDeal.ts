import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { emitPipelineLedgerEvent } from "@/lib/pipeline/emitPipelineLedgerEvent";
import { recomputeDealDocumentState } from "@/lib/documentTruth/recomputeDealDocumentState";
import type { AutoUnderwriteResult, AutoUnderwriteStep } from "./autoUnderwriteTypes";
import { SBA_TYPES } from "./autoUnderwriteTypes";

/**
 * Step runner: emits start/complete/fail events to deal_pipeline_ledger.
 * Re-throws on failure to stop the chain.
 */
async function runStep(
  step: AutoUnderwriteStep,
  dealId: string,
  bankId: string,
  fn: () => Promise<void>,
): Promise<number> {
  const start = Date.now();
  await emitPipelineLedgerEvent({
    eventKey: `auto_underwrite.${step}.started`,
    dealId,
    bankId,
    status: "ok",
    payload: { step },
  });

  try {
    await fn();
    const durationMs = Date.now() - start;
    await emitPipelineLedgerEvent({
      eventKey: `auto_underwrite.${step}.complete`,
      dealId,
      bankId,
      status: "ok",
      payload: { step, duration_ms: durationMs },
      durationMs,
    });
    return durationMs;
  } catch (err) {
    const durationMs = Date.now() - start;
    await emitPipelineLedgerEvent({
      eventKey: `auto_underwrite.${step}.failed`,
      dealId,
      bankId,
      status: "error",
      payload: {
        step,
        duration_ms: durationMs,
        error: err instanceof Error ? err.message : String(err),
      },
      durationMs,
    });
    throw err;
  }
}

/**
 * Autonomous deal underwriting orchestrator.
 * Runs the full underwriting chain sequentially.
 * Each step emits to deal_pipeline_ledger.
 * Stops on first failure (except voice summary which is non-fatal).
 */
export async function autoUnderwriteDeal(
  dealId: string,
  bankId: string,
): Promise<AutoUnderwriteResult> {
  const overallStart = Date.now();
  const stepsCompleted: AutoUnderwriteStep[] = [];
  let memoReady = false;
  let voiceSummaryReady = false;

  await emitPipelineLedgerEvent({
    eventKey: "auto_underwrite.started",
    dealId,
    bankId,
    status: "ok",
    payload: { trigger: "intake_completed" },
  });

  const sb = supabaseAdmin();

  // Load deal to determine type
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_type, lifecycle_stage")
    .eq("id", dealId)
    .single();

  if (!deal) {
    await emitPipelineLedgerEvent({
      eventKey: "auto_underwrite.failed",
      dealId,
      bankId,
      status: "error",
      payload: { error: "deal_not_found" },
    });
    return {
      dealId,
      status: "failed",
      stepsCompleted: [],
      failedStep: "recompute_document_state",
      failureReason: "Deal not found",
      durationMs: Date.now() - overallStart,
      memoReady: false,
      voiceSummaryReady: false,
    };
  }

  const isSba = SBA_TYPES.includes((deal.deal_type ?? "") as (typeof SBA_TYPES)[number]);

  try {
    // Step 1: Recompute document state
    await runStep("recompute_document_state", dealId, bankId, async () => {
      await recomputeDealDocumentState(dealId);
    });
    stepsCompleted.push("recompute_document_state");

    // Step 2: Extraction
    await runStep("extraction", dealId, bankId, async () => {
      // Queue extraction via ledger — same pattern as runExtraction handler
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        event_key: "canonical_action.run_extraction",
        stage: "canonical_action.run_extraction",
        status: "working",
        ui_state: "working",
        ui_message: "Running document extraction",
        meta: { source: "auto_underwrite", trigger: "orchestrator" },
      });
    });
    stepsCompleted.push("extraction");

    // Step 3: Financial snapshot
    await runStep("financial_snapshot", dealId, bankId, async () => {
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        event_key: "canonical_action.generate_financial_snapshot",
        stage: "canonical_action.generate_financial_snapshot",
        status: "working",
        ui_state: "working",
        ui_message: "Generating financial snapshot",
        meta: { source: "auto_underwrite", trigger: "orchestrator" },
      });
    });
    stepsCompleted.push("financial_snapshot");

    // Step 4: Model Engine V2 (flag-gated)
    await runStep("model_engine_v2", dealId, bankId, async () => {
      const v2Enabled = process.env.USE_MODEL_ENGINE_V2 === "true" ||
        process.env.MODEL_ENGINE_PRIMARY === "V2";
      if (!v2Enabled) return; // Skip silently if not enabled
      // V2 snapshot persistence triggered via existing model engine path
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        event_key: "model_v2.snapshot_requested",
        stage: "model_v2.snapshot_requested",
        status: "working",
        ui_state: "working",
        ui_message: "Computing model V2 snapshot",
        meta: { source: "auto_underwrite" },
      });
    });
    stepsCompleted.push("model_engine_v2");

    // Step 5: SBA package (conditional)
    if (isSba) {
      await runStep("sba_package", dealId, bankId, async () => {
        // Trigger SBA package generation for SBA deals
        await sb.from("deal_pipeline_ledger").insert({
          deal_id: dealId,
          bank_id: bankId,
          event_key: "auto_underwrite.sba_package.queued",
          stage: "auto_underwrite.sba_package.queued",
          status: "working",
          ui_state: "working",
          ui_message: "Computing SBA package",
          meta: { source: "auto_underwrite" },
        });
      });
      stepsCompleted.push("sba_package");
    }

    // Step 6: Omega advisory
    await runStep("omega_advisory", dealId, bankId, async () => {
      try {
        const { getOmegaAdvisoryState } = await import("@/core/omega/OmegaAdvisoryAdapter");
        await getOmegaAdvisoryState(dealId);
      } catch {
        // Omega is advisory-only — non-fatal
      }
    });
    stepsCompleted.push("omega_advisory");

    // Step 7: Credit memo
    await runStep("credit_memo", dealId, bankId, async () => {
      const { buildCanonicalCreditMemo } = await import(
        "@/lib/creditMemo/canonical/buildCanonicalCreditMemo"
      );
      await buildCanonicalCreditMemo({ dealId, bankId });
    });
    stepsCompleted.push("credit_memo");
    memoReady = true;

    // Step 8: Narratives
    await runStep("narratives", dealId, bankId, async () => {
      // Trigger narrative generation via existing route pattern
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        event_key: "auto_underwrite.narratives.queued",
        stage: "auto_underwrite.narratives.queued",
        status: "working",
        ui_state: "working",
        ui_message: "Generating credit memo narratives",
        meta: { source: "auto_underwrite" },
      });
    });
    stepsCompleted.push("narratives");

    // Step 9: Voice summary (NON-FATAL)
    try {
      await runStep("voice_summary", dealId, bankId, async () => {
        // Voice synthesis — attempt but do not fail the chain
        await sb.from("deal_pipeline_ledger").insert({
          deal_id: dealId,
          bank_id: bankId,
          event_key: "auto_underwrite.voice_summary.queued",
          stage: "auto_underwrite.voice_summary.queued",
          status: "working",
          ui_state: "working",
          ui_message: "Synthesizing voice summary",
          meta: { source: "auto_underwrite" },
        });
      });
      stepsCompleted.push("voice_summary");
      voiceSummaryReady = true;
    } catch {
      // Voice summary failure is non-fatal — chain is still complete
    }

    const durationMs = Date.now() - overallStart;

    await emitPipelineLedgerEvent({
      eventKey: "auto_underwrite.complete",
      dealId,
      bankId,
      status: "ok",
      payload: {
        steps_completed: stepsCompleted.length,
        duration_ms: durationMs,
        memo_ready: memoReady,
        voice_summary_ready: voiceSummaryReady,
      },
      durationMs,
    });

    return {
      dealId,
      status: "complete",
      stepsCompleted,
      durationMs,
      memoReady,
      voiceSummaryReady,
    };
  } catch (err) {
    const durationMs = Date.now() - overallStart;
    const failedStep = getNextStep(stepsCompleted, isSba);
    const failureReason = err instanceof Error ? err.message : String(err);

    await emitPipelineLedgerEvent({
      eventKey: "auto_underwrite.failed",
      dealId,
      bankId,
      status: "error",
      payload: {
        failed_step: failedStep,
        failure_reason: failureReason,
        steps_completed: stepsCompleted.length,
        duration_ms: durationMs,
      },
      durationMs,
    });

    return {
      dealId,
      status: "failed",
      stepsCompleted,
      failedStep,
      failureReason,
      durationMs,
      memoReady,
      voiceSummaryReady,
    };
  }
}

function getNextStep(completed: AutoUnderwriteStep[], isSba: boolean): AutoUnderwriteStep {
  const order: AutoUnderwriteStep[] = [
    "recompute_document_state",
    "extraction",
    "financial_snapshot",
    "model_engine_v2",
    ...(isSba ? ["sba_package" as const] : []),
    "omega_advisory",
    "credit_memo",
    "narratives",
    "voice_summary",
  ];
  const completedSet = new Set(completed);
  return order.find((s) => !completedSet.has(s)) ?? "recompute_document_state";
}
