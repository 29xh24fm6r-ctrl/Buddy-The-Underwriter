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

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { updateDealIfRunOwner } from "./updateDealIfRunOwner";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { getBaseUrl } from "@/lib/net/getBaseUrl";
import type { StuckVerdict } from "./detectStuckProcessing";

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
  const newRunId = crypto.randomUUID();
  const now = new Date().toISOString();
  const sb = supabaseAdmin();

  try {
    // Reset run markers with new run_id. CAS on the stale run_id ensures
    // we don't clobber a run that was concurrently started by another path.
    const resetPayload: Record<string, unknown> = {
      intake_processing_queued_at: now,
      intake_processing_started_at: null,
      intake_processing_run_id: newRunId,
      intake_processing_last_heartbeat_at: null,
      intake_processing_error: null,
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

    // Fire off the process route (same mechanism as confirm route)
    const workerSecret = process.env.WORKER_SECRET ?? "";
    const base = getBaseUrl();

    if (base && workerSecret) {
      void fetch(`${base}/api/deals/${dealId}/intake/process`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-buddy-internal": "1",
          "x-worker-secret": workerSecret,
        },
        body: JSON.stringify({ dealId, bankId, runId: newRunId }),
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "unknown");
          throw new Error(`process_route_${res.status}: ${text.slice(0, 200)}`);
        }
      }).catch(async (err) => {
        console.error("[handleStuckRecovery] re-enqueue handoff failed", {
          dealId,
          newRunId,
          error: err?.message,
        });

        await writeEvent({
          dealId,
          kind: "intake.processing_reenqueue_handoff_failed",
          scope: "intake",
          meta: {
            run_id: newRunId,
            error: err?.message?.slice(0, 200),
            observability_version: PROCESSING_OBSERVABILITY_VERSION,
          },
        });

        // Fail-closed: if handoff fails, transition to error
        await updateDealIfRunOwner(dealId, newRunId, {
          intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
          intake_processing_error: `reenqueue_handoff_failed: ${err?.message?.slice(0, 200)}`,
        });
      });
    } else if (!base) {
      // Local dev fallback — inline processing
      const { enqueueDealProcessing } = await import(
        "@/lib/intake/processing/enqueueDealProcessing"
      );
      void enqueueDealProcessing(dealId, bankId, newRunId).catch(async (err: any) => {
        console.error("[handleStuckRecovery] inline re-enqueue failed", {
          dealId,
          newRunId,
          error: err?.message,
        });
        await updateDealIfRunOwner(dealId, newRunId, {
          intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
          intake_processing_error: `reenqueue_inline_failed: ${err?.message?.slice(0, 200)}`,
        });
      });
    } else {
      // base URL exists but no WORKER_SECRET — fail closed
      console.error("[handleStuckRecovery] WORKER_SECRET missing — cannot re-enqueue", { dealId });

      await writeEvent({
        dealId,
        kind: "intake.processing_reenqueue_misconfigured",
        scope: "intake",
        meta: {
          run_id: newRunId,
          reason: "WORKER_SECRET env var is empty",
          observability_version: PROCESSING_OBSERVABILITY_VERSION,
        },
      });

      await updateDealIfRunOwner(dealId, newRunId, {
        intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
        intake_processing_error: "reenqueue_misconfigured: WORKER_SECRET missing",
      });

      return {
        phase: "PROCESSING_COMPLETE_WITH_ERRORS",
        error: "reenqueue_misconfigured: WORKER_SECRET missing",
        recovered: true,
        reenqueued: false,
      };
    }

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

  await updateDealIfRunOwner(dealId, staleRunId, {
    intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
    intake_processing_error: errorMsg,
  });

  return {
    phase: "PROCESSING_COMPLETE_WITH_ERRORS",
    error: errorMsg,
    recovered: true,
    reenqueued: false,
  };
}
