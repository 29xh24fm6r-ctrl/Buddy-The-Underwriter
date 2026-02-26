/**
 * Durable outbox consumer for intake processing triggers.
 *
 * Claims `intake.process` rows from buddy_outbox_events via the
 * `claim_intake_outbox_batch` RPC (FOR UPDATE SKIP LOCKED), then
 * executes `runIntakeProcessing()` for each claimed row.
 *
 * Delivery semantics:
 *   - Success: row marked delivered (delivered_at + delivered_to)
 *   - Failure: attempts incremented, exponential backoff via next_attempt_at
 *   - Dead letter: attempts >= 5 → dead_lettered_at set, no further retries
 *
 * Called by: /api/workers/intake-outbox (Vercel Cron, every 1 min)
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { runIntakeProcessing } from "@/lib/intake/processing/runIntakeProcessing";

const DEAD_LETTER_THRESHOLD = 5;
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_CAP_SECONDS = 3600; // 1 hour

export type OutboxResult = {
  claimed: number;
  processed: number;
  failed: number;
  dead_lettered: number;
};

interface ClaimedRow {
  id: string;
  deal_id: string;
  bank_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Exponential backoff: min(2^attempts * 30 seconds, 1 hour).
 */
function backoffSeconds(attempts: number): number {
  return Math.min(
    Math.pow(2, attempts) * BACKOFF_BASE_SECONDS,
    BACKOFF_CAP_SECONDS,
  );
}

export async function processIntakeOutbox(
  maxRows?: number,
): Promise<OutboxResult> {
  const sb = supabaseAdmin();
  const claimOwner = `vercel-intake-${Date.now()}`;

  // ── Claim batch via RPC ────────────────────────────────────────────────
  const { data: rows, error: claimErr } = await sb.rpc(
    "claim_intake_outbox_batch",
    {
      p_claim_owner: claimOwner,
      p_claim_ttl_seconds: 120,
      p_limit: maxRows ?? 5,
    },
  );

  if (claimErr) {
    console.error("[intake-outbox] claim RPC failed:", claimErr.message);
    return { claimed: 0, processed: 0, failed: 0, dead_lettered: 0 };
  }

  const claimed = (rows as ClaimedRow[] | null) ?? [];
  if (claimed.length === 0) {
    return { claimed: 0, processed: 0, failed: 0, dead_lettered: 0 };
  }

  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of claimed) {
    const dealId = row.deal_id;
    const bankId = row.bank_id;
    const runId = (row.payload as any)?.run_id as string | undefined;

    if (!bankId || !runId) {
      console.error("[intake-outbox] missing bankId or runId in outbox row", {
        rowId: row.id,
        dealId,
        bankId,
        runId,
      });
      await markFailed(sb, row.id, "missing_bank_id_or_run_id", row.attempts);
      failed += 1;
      continue;
    }

    // ── Pre-flight: skip stale outbox rows (superseded run_id) ───────
    const { data: preflight } = await sb
      .from("deals")
      .select("intake_processing_run_id, intake_phase")
      .eq("id", dealId)
      .maybeSingle();

    const currentRunId = (preflight as any)?.intake_processing_run_id;
    const currentPhase = (preflight as any)?.intake_phase;

    // Skip if run_id superseded (another recovery already took over)
    if (currentRunId && currentRunId !== runId) {
      await sb
        .from("buddy_outbox_events")
        .update({
          delivered_at: new Date().toISOString(),
          delivered_to: "skipped_superseded",
          last_error: `run_id_mismatch: current=${currentRunId} outbox=${runId}`,
        })
        .eq("id", row.id);
      processed += 1;
      continue;
    }

    // Skip if deal already in terminal phase
    if (currentPhase && currentPhase !== "CONFIRMED_READY_FOR_PROCESSING") {
      await sb
        .from("buddy_outbox_events")
        .update({
          delivered_at: new Date().toISOString(),
          delivered_to: "skipped_already_terminal",
          last_error: `phase_already_terminal: ${currentPhase}`,
        })
        .eq("id", row.id);
      processed += 1;
      continue;
    }

    try {
      await runIntakeProcessing(dealId, bankId, runId);

      // ── Post-flight: verify terminal phase before marking delivered ──
      const { data: postCheck } = await sb
        .from("deals")
        .select("intake_phase")
        .eq("id", dealId)
        .maybeSingle();

      const finalPhase = (postCheck as any)?.intake_phase;
      if (finalPhase === "CONFIRMED_READY_FOR_PROCESSING") {
        throw new Error(
          `phase_not_terminal: deal ${dealId} still in CONFIRMED_READY_FOR_PROCESSING after processing`,
        );
      }

      // ── Success: mark delivered ────────────────────────────────────
      await sb
        .from("buddy_outbox_events")
        .update({
          delivered_at: new Date().toISOString(),
          delivered_to: "intake_processor",
          last_error: null,
        })
        .eq("id", row.id);

      processed += 1;
    } catch (err: any) {
      console.error("[intake-outbox] processing failed", {
        rowId: row.id,
        dealId,
        runId,
        error: err?.message?.slice(0, 200),
      });

      const isDeadLetter = await markFailed(
        sb,
        row.id,
        err?.message?.slice(0, 500) ?? "unknown",
        row.attempts,
      );

      if (isDeadLetter) {
        deadLettered += 1;
      }
      failed += 1;
    }
  }

  console.log("[intake-outbox] batch complete", {
    claimed: claimed.length,
    processed,
    failed,
    deadLettered,
  });

  return {
    claimed: claimed.length,
    processed,
    failed,
    dead_lettered: deadLettered,
  };
}

/**
 * Mark an outbox row as failed. Increments attempts, sets exponential backoff.
 * Dead-letters if attempts >= threshold.
 *
 * @returns true if the row was dead-lettered.
 */
async function markFailed(
  sb: ReturnType<typeof supabaseAdmin>,
  rowId: string,
  error: string,
  currentAttempts: number,
): Promise<boolean> {
  const newAttempts = currentAttempts + 1;

  if (newAttempts >= DEAD_LETTER_THRESHOLD) {
    await sb
      .from("buddy_outbox_events")
      .update({
        attempts: newAttempts,
        last_error: error.slice(0, 500),
        dead_lettered_at: new Date().toISOString(),
        next_attempt_at: null,
        claimed_at: null,
        claim_owner: null,
      })
      .eq("id", rowId);

    console.error("[intake-outbox] DEAD-LETTERED", {
      rowId,
      attempts: newAttempts,
      error: error.slice(0, 200),
    });
    return true;
  }

  const delaySec = backoffSeconds(newAttempts);
  const nextAttempt = new Date(Date.now() + delaySec * 1000).toISOString();

  await sb
    .from("buddy_outbox_events")
    .update({
      attempts: newAttempts,
      last_error: error.slice(0, 500),
      next_attempt_at: nextAttempt,
      claimed_at: null,
      claim_owner: null,
    })
    .eq("id", rowId);

  return false;
}
