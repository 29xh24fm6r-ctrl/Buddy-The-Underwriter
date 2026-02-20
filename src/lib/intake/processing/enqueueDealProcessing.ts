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
 */
export async function enqueueDealProcessing(
  dealId: string,
  bankId: string,
): Promise<EnqueueResult> {
  const sb = supabaseAdmin();

  let phase: string | null;
  try {
    const { data, error } = await sb
      .from("deals")
      .select("intake_phase")
      .eq("id", dealId)
      .maybeSingle();

    if (error) throw error;
    phase = (data as any)?.intake_phase ?? null;
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

  const result = await processConfirmedIntake(dealId, bankId);
  return { ok: true, result };
}
