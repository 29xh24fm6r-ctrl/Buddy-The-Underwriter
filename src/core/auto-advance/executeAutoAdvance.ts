import "server-only";

/**
 * Phase 65G — Auto-Advance Execution
 *
 * Executes a deterministic stage advancement when eligible.
 * Idempotent, auditable, recomputes state after advancement.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { AutoAdvanceEvaluation } from "@/core/sla/types";

export type ExecuteAutoAdvanceResult = {
  ok: boolean;
  advanced: boolean;
  fromStage: string | null;
  toStage: string | null;
  error?: string;
};

export async function executeAutoAdvance(
  dealId: string,
  bankId: string,
  evaluation: AutoAdvanceEvaluation,
): Promise<ExecuteAutoAdvanceResult> {
  if (!evaluation.eligible || !evaluation.toStage) {
    return {
      ok: true,
      advanced: false,
      fromStage: evaluation.fromStage,
      toStage: null,
    };
  }

  const sb = supabaseAdmin();

  try {
    // Check current stage — idempotent guard
    const { data: deal } = await sb
      .from("deals")
      .select("lifecycle_stage")
      .eq("id", dealId)
      .single();

    if (!deal) {
      return { ok: false, advanced: false, fromStage: null, toStage: null, error: "Deal not found." };
    }

    // Already at or beyond target — noop
    if (deal.lifecycle_stage !== evaluation.fromStage) {
      return {
        ok: true,
        advanced: false,
        fromStage: deal.lifecycle_stage,
        toStage: evaluation.toStage,
      };
    }

    // Advance stage
    await sb
      .from("deals")
      .update({
        lifecycle_stage: evaluation.toStage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dealId);

    // Write auto-advance event
    await sb.from("deal_auto_advance_events").insert({
      deal_id: dealId,
      bank_id: bankId,
      from_stage: evaluation.fromStage,
      to_stage: evaluation.toStage,
      trigger_code: evaluation.triggerCode,
      evidence: evaluation.evidence,
      executed_by: "system",
    });

    // Write lifecycle advancement event for stage-age tracking
    await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "deal.lifecycle.advanced",
      payload: {
        from_stage: evaluation.fromStage,
        to_stage: evaluation.toStage,
        trigger: evaluation.triggerCode,
        auto_advance: true,
      },
    });

    // Ledger audit
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "deal.auto_advanced",
      uiState: "done",
      uiMessage: `Auto-advanced from ${evaluation.fromStage} to ${evaluation.toStage}`,
      meta: {
        from_stage: evaluation.fromStage,
        to_stage: evaluation.toStage,
        trigger_code: evaluation.triggerCode,
        evidence: evaluation.evidence,
      },
    }).catch(() => {});

    return {
      ok: true,
      advanced: true,
      fromStage: evaluation.fromStage,
      toStage: evaluation.toStage,
    };
  } catch (err) {
    return {
      ok: false,
      advanced: false,
      fromStage: evaluation.fromStage,
      toStage: evaluation.toStage,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
