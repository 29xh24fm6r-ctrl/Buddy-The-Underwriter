/**
 * Shared auto-recovery handler for stuck intake processing runs.
 *
 * Used by both /intake/review and /intake/processing-status routes.
 *
 * FIX 2A: For `queued_never_started`, re-enqueues processing instead of
 * just transitioning to error. For other stuck reasons, transitions to
 * PROCESSING_COMPLETE_WITH_ERRORS as before.
 *
 * Invariants:
 * - Idempotent: multiple calls with the same stuck state converge to the same outcome.
 * - No infinite auto_recovery spam: re-enqueue changes run_id, so subsequent polls
 *   see a fresh run and the old stuck detection doesn't fire again.
 * - Fail-closed: if re-enqueue fails, transitions to error (no silent path).
 */

import "server-only";

import { writeEvent } from "@/lib/ledger/writeEvent";
import { updateDealIfRunOwner } from "./updateDealIfRunOwner";
import { computeDealPhasePatch } from "./computeDealPhasePatch";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { insertOutboxEvent } from "@/lib/outbox/insertOutboxEvent";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { StuckVerdict } from "./detectStuckProcessing";

// SPEC-INTAKE-OUTBOX-WORKER-CLAIM-PATH-1 Item 10:
// When the latest live intake.process row stays at attempts=0 + claimed_at=null
// for longer than this window, the worker is not claiming — the cron is down,
// the wrapper RPC is missing, or PostgREST cache is stale. Reenqueuing a fresh
// row only piles on; surface the broken claim path instead so the schema-drift
// signal is visible rather than masked behind unbounded reenqueues.
const WORKER_NOT_CLAIMING_THRESHOLD_MS = 5 * 60 * 1000;

// Circuit breaker: max total reenqueue attempts for a deal across its whole
// queued_never_started stuck-recovery lifecycle (see intake_stuck_recovery_attempts
// column). Each reenqueue creates a fresh outbox row/run_id, so without this
// cross-cycle counter the per-row/per-run staleness checks above never
// accumulate and recovery could reenqueue indefinitely. Aligned with (not
// imported from — worker/outbox internals are out of scope here)
// processIntakeOutbox.ts's DEAD_LETTER_THRESHOLD, so the pipeline converges
// on one shared "give up after 5" convention.
const MAX_STUCK_RECOVERY_ATTEMPTS = 5;

// ── Types ──────────────────────────────────────────────────────────────

export type RecoveryOutcome = {
  /** Final phase after recovery. */
  phase: string;
  /** Error string on the deal (null if re-enqueued). */
  error: string | null;
  /** True if recovery action was taken. */
  recovered: boolean;
  /** True if we re-enqueued (vs. transitioned to error). */
  reenqueued: boolean;
  /** New run_id if re-enqueued. */
  new_run_id?: string;
};

// ── Recovery Logic ────────────────────────────────────────────────────

/**
 * Handle a stuck processing run.
 *
 * For `queued_never_started`: attempt to re-enqueue processing with a fresh run_id.
 * For other reasons: transition to PROCESSING_COMPLETE_WITH_ERRORS.
 */
export async function handleStuckRecovery(
  dealId: string,
  bankId: string,
  verdict: StuckVerdict & { stuck: true },
  staleRunId: string | undefined,
): Promise<RecoveryOutcome> {
  // ── queued_never_started: re-enqueue ────────────────────────────────
  if (verdict.reason === "queued_never_started") {
    return reenqueueProcessing(dealId, bankId, verdict, staleRunId);
  }

  // ── All other reasons: transition to error ──────────────────────────
  return transitionToError(dealId, verdict, staleRunId);
}

// ── Re-enqueue (FIX 2A) ───────────────────────────────────────────────

async function reenqueueProcessing(
  dealId: string,
  bankId: string,
  verdict: StuckVerdict & { stuck: true },
  staleRunId: string | undefined,
): Promise<RecoveryOutcome> {
  // ── Pre-flight: circuit breaker on total reenqueue attempts ───────────
  // Track attempts across the WHOLE stuck-recovery lifecycle for this deal
  // (not just this row/run), so a systemic failure (worker permanently down,
  // or the same deal deterministically failing every attempt) converges to a
  // terminal, manually-actionable state instead of reenqueuing forever.
  const sbAttempts = supabaseAdmin();
  const { data: dealAttemptsRow } = await sbAttempts
    .from("deals")
    .select("intake_stuck_recovery_attempts")
    .eq("id", dealId)
    .maybeSingle();
  const priorAttempts = (dealAttemptsRow as any)?.intake_stuck_recovery_attempts ?? 0;

  if (priorAttempts >= MAX_STUCK_RECOVERY_ATTEMPTS) {
    void writeEvent({
      dealId,
      kind: "intake.processing_stuck_recovery_exhausted",
      scope: "intake",
      requiresHumanReview: true,
      meta: {
        reason: verdict.reason,
        prior_attempts: priorAttempts,
        max_attempts: MAX_STUCK_RECOVERY_ATTEMPTS,
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });

    // Distinct exhaustion event already emitted above for observability;
    // fall through to the existing terminal-error path (unchanged verdict —
    // the underlying stuck reason is still accurate) so this converges on
    // the same PROCESSING_COMPLETE_WITH_ERRORS / manual-intervention state
    // recoverStuckIntakeDeals.ts already uses for its own exhausted paths.
    return transitionToError(dealId, verdict, staleRunId);
  }

  // ── Pre-flight: detect a broken claim path before piling on rows ──────
  // If the latest live intake.process row has been sitting at attempts=0
  // claimed_at=null past WORKER_NOT_CLAIMING_THRESHOLD_MS, the worker is
  // not running. Reenqueuing produces another row that will sit unclaimed
  // and the cycle repeats. Emit a distinct signal and SKIP the reenqueue.
  try {
    const sb0 = supabaseAdmin();
    const { data: latestLive } = await sb0
      .from("buddy_outbox_events")
      .select("id, attempts, claimed_at, created_at")
      .eq("deal_id", dealId)
      .eq("kind", "intake.process")
      .is("delivered_at", null)
      .is("dead_lettered_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestLive) {
      const live = latestLive as {
        id: string;
        attempts: number;
        claimed_at: string | null;
        created_at: string;
      };
      const ageMs = Date.now() - new Date(live.created_at).getTime();
      if (
        live.attempts === 0 &&
        live.claimed_at === null &&
        ageMs > WORKER_NOT_CLAIMING_THRESHOLD_MS
      ) {
        void writeEvent({
          dealId,
          kind: "intake.processing_worker_not_claiming",
          scope: "intake",
          meta: {
            reason: "claim_path_broken_or_cron_not_running",
            outbox_id: live.id,
            outbox_age_seconds: Math.round(ageMs / 1000),
            stuck_reason: verdict.reason,
            observability_version: PROCESSING_OBSERVABILITY_VERSION,
          },
        });

        return {
          phase: "CONFIRMED_READY_FOR_PROCESSING",
          error: "worker_not_claiming",
          recovered: false,
          reenqueued: false,
        };
      }
    }
  } catch {
    // Non-fatal — fall through to the normal reenqueue path.
  }

  const newRunId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    // Reset run markers with new run_id. CAS on the stale run_id ensures
    // we don't clobber a run that was concurrently started by another path.
    // Circuit breaker: bump the cross-lifecycle attempts counter so it keeps
    // accumulating across reenqueues instead of resetting with each fresh
    // run_id/outbox row — see the pre-flight check above and the migration
    // comment on deals.intake_stuck_recovery_attempts.
    const resetPayload: Record<string, unknown> = {
      intake_processing_queued_at: now,
      intake_processing_started_at: null,
      intake_processing_run_id: newRunId,
      intake_processing_last_heartbeat_at: null,
      intake_processing_error: null,
      intake_stuck_recovery_attempts: priorAttempts + 1,
    };

    const casUpdated = await updateDealIfRunOwner(dealId, staleRunId, resetPayload);

    if (!casUpdated) {
      // CAS failed — another recovery path beat us. That's fine — not stuck anymore.
      return {
        phase: "CONFIRMED_READY_FOR_PROCESSING",
        error: null,
        recovered: false,
        reenqueued: false,
      };
    }

    // Emit re-enqueue event (distinct from the old auto_recovery)
    await writeEvent({
      dealId,
      kind: "intake.processing_auto_reenqueued",
      scope: "intake",
      meta: {
        reason: verdict.reason,
        age_ms: verdict.age_ms,
        previous_run_id: staleRunId ?? null,
        new_run_id: newRunId,
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });

    // SPEC-INTAKE-FLOW-FIX-1 Fix 3: Before enqueuing, attempt to clear any
    // zombie advisory lock from a previous run. If the lock is held by a dead
    // connection, terminate the holder so the new outbox event can be processed.
    try {
      const sb = supabaseAdmin();
      const { data: terminated } = await sb.rpc(
        "pg_terminate_backend_holding_advisory_lock",
        { lock_id: 42001003 },
      );
      if (terminated) {
        console.log("[handleStuckRecovery] terminated zombie lock holder for intake outbox");
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      // Non-fatal — proceed with retry regardless
    }

    // Insert outbox row — the durable consumer picks it up on next cron tick.
    await insertOutboxEvent({
      kind: "intake.process",
      dealId,
      bankId,
      payload: { deal_id: dealId, run_id: newRunId, reason: "stuck_recovery" },
    });

    return {
      phase: "CONFIRMED_READY_FOR_PROCESSING",
      error: null,
      recovered: true,
      reenqueued: true,
      new_run_id: newRunId,
    };
  } catch (err: any) {
    // Re-enqueue failed — fall back to error transition
    console.error("[handleStuckRecovery] re-enqueue failed, falling back to error", {
      dealId,
      error: err?.message,
    });

    return transitionToError(dealId, verdict, staleRunId);
  }
}

// ── Error Transition (existing behavior) ──────────────────────────────

async function transitionToError(
  dealId: string,
  verdict: StuckVerdict & { stuck: true },
  staleRunId: string | undefined,
): Promise<RecoveryOutcome> {
  const errorMsg = `auto_recovery: ${verdict.reason}`;

  void writeEvent({
    dealId,
    kind: "intake.processing_auto_recovery",
    scope: "intake",
    meta: {
      reason: verdict.reason,
      age_ms: verdict.age_ms,
      run_id: staleRunId ?? null,
      observability_version: PROCESSING_OBSERVABILITY_VERSION,
    },
  });

  await updateDealIfRunOwner(dealId, staleRunId, computeDealPhasePatch(
    "PROCESSING_COMPLETE_WITH_ERRORS",
    { errorSummary: errorMsg },
  ));

  return {
    phase: "PROCESSING_COMPLETE_WITH_ERRORS",
    error: errorMsg,
    recovered: true,
    reenqueued: false,
  };
}
