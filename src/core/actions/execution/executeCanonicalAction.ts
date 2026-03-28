import "server-only";

/**
 * Phase 65E — Canonical Action Executor
 *
 * Translates canonical Buddy actions into executable, auditable operating commands.
 * Every execution is idempotent, recorded, and ledger-emitted.
 *
 * This layer is side-effectful and server-only.
 * deriveNextActions remains pure and untouched.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type {
  ExecuteCanonicalActionInput,
  ExecuteCanonicalActionResult,
} from "./types";
import { CANONICAL_ACTION_EXECUTION_MAP } from "./canonicalActionExecutionMap";
import { executeHandler } from "./handlers";

export async function executeCanonicalAction(
  input: ExecuteCanonicalActionInput,
): Promise<ExecuteCanonicalActionResult> {
  const sb = supabaseAdmin();
  const mapping = CANONICAL_ACTION_EXECUTION_MAP[input.action.code];

  try {
    const result = await executeHandler(sb, input, mapping);

    await sb.from("canonical_action_executions").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      action_code: input.action.code,
      source: "canonical_action",
      target_system: result.target,
      target_record_id: result.targetRecordId,
      execution_status: result.status,
      executed_by: input.executedBy,
      actor_type: input.actorType,
      error_text: result.ok ? null : result.error ?? null,
    });

    await logLedgerEvent({
      dealId: input.dealId,
      bankId: input.bankId,
      eventKey: "canonical_action.executed",
      uiState: result.ok ? "done" : "error",
      uiMessage: `Canonical action executed: ${input.action.code}`,
      meta: {
        action_code: input.action.code,
        execution_status: result.status,
        target_system: result.target,
        target_record_id: result.targetRecordId,
      },
    }).catch(() => {});

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    try {
      await sb.from("canonical_action_executions").insert({
        deal_id: input.dealId,
        bank_id: input.bankId,
        action_code: input.action.code,
        source: "canonical_action",
        target_system: "unknown",
        target_record_id: null,
        execution_status: "failed",
        executed_by: input.executedBy,
        actor_type: input.actorType,
        error_text: error,
      });
    } catch { /* non-fatal audit write */ }

    return {
      ok: false,
      actionCode: input.action.code,
      target: "unknown",
      targetRecordId: null,
      status: "failed",
      error,
    };
  }
}
