/**
 * Phase E0 — Intake Gate Boundary (fail-closed)
 *
 * Hard gate: no downstream processing runs unless
 * deal.intake_phase === 'CONFIRMED_READY_FOR_PROCESSING'.
 *
 * No downstream function may bypass this check.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { processConfirmedIntake } from "./processConfirmedIntake";
import type { ProcessConfirmedResult } from "./processConfirmedIntake";

export type EnqueueResult =
  | { ok: true; result: ProcessConfirmedResult }
  | { ok: false; reason: string };

/**
 * Orchestration boundary for downstream processing.
 *
 * Reads deal.intake_phase and only proceeds if confirmed.
 * Fail-closed: any error reading state → block.
 *
 * @param runId - The processing run ID stamped by the confirm route.
 *                Used for idempotency guard (CAS) and heartbeat scoping.
 */
export async function enqueueDealProcessing(
  dealId: string,
  bankId: string,
  runId?: string,
): Promise<EnqueueResult> {
  const sb = supabaseAdmin();

  let phase: string | null;
  let currentRunId: string | null = null;
  try {
    const { data, error } = await sb
      .from("deals")
      .select("intake_phase, intake_processing_run_id")
      .eq("id", dealId)
      .maybeSingle();

    if (error) throw error;
    phase = (data as any)?.intake_phase ?? null;
    currentRunId = (data as any)?.intake_processing_run_id ?? null;
  } catch (err: any) {
    // FAIL-CLOSED: cannot read state → do not process
    console.error("[enqueueDealProcessing] FAIL-CLOSED — cannot read intake_phase", {
      dealId,
      error: err?.message,
    });
    return { ok: false, reason: `gate_read_error: ${err?.message}` };
  }

  if (phase !== "CONFIRMED_READY_FOR_PROCESSING") {
    console.log("[enqueueDealProcessing] gate blocked — intake not confirmed", {
      dealId,
      intake_phase: phase,
    });
    return { ok: false, reason: `intake_not_confirmed: ${phase}` };
  }

  // Idempotency guard: if a runId was provided, verify it matches the current
  // run on the deal. This prevents a stale/superseded enqueue from executing.
  if (runId && currentRunId && currentRunId !== runId) {
    console.log("[enqueueDealProcessing] run_id mismatch — superseded", {
      dealId,
      expected: runId,
      current: currentRunId,
    });
    return { ok: false, reason: `run_id_mismatch: expected=${runId} current=${currentRunId}` };
  }

  void writeEvent({
    dealId,
    kind: "intake.processing_enqueued",
    scope: "intake",
    meta: {
      run_id: runId ?? null,
      observability_version: PROCESSING_OBSERVABILITY_VERSION,
    },
  });

  const result = await processConfirmedIntake(dealId, bankId, runId);
  return { ok: true, result };
}
