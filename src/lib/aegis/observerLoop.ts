import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "./writeSystemEvent";
import { classifyError, isRetryable, calculateBackoffMs } from "./classifyError";
import type { UnifiedJob, AegisJobTable, ObserverTickResult } from "./types";

const STUCK_THRESHOLD_MIN = 10;
const DEAD_WORKER_THRESHOLD_MIN = 15;
const MAX_AUTO_RETRY = 5;

/**
 * Main observer tick — called by cron every 5 minutes.
 *
 * Scans for:
 * 1. Failed jobs that might be retryable
 * 2. Stuck jobs with expired leases
 * 3. Dead workers (no heartbeat for N minutes)
 *
 * Actions:
 * - Auto-retries transient failures with backoff
 * - Releases stuck leases back to QUEUED
 * - Marks unreachable workers as dead
 * - Emits system events for every action taken
 */
export async function runObserverTick(): Promise<ObserverTickResult> {
  const sb = supabaseAdmin();
  const result: ObserverTickResult = {
    ok: true,
    scanned: { stuck_jobs: 0, failed_jobs: 0, dead_workers: 0 },
    actions: {
      retried: 0,
      marked_dead: 0,
      workers_marked_dead: 0,
      events_emitted: 0,
    },
    errors: [],
  };

  // ── 1. Scan for stuck/failed jobs via RPC ──
  try {
    const { data: jobs, error } = await sb.rpc(
      "find_stuck_or_failed_jobs" as any,
      {
        p_stuck_minutes: STUCK_THRESHOLD_MIN,
        p_limit: 50,
      },
    );

    if (error) {
      result.errors.push(`find_stuck_or_failed_jobs: ${error.message}`);
    } else if (jobs) {
      for (const job of jobs as unknown as UnifiedJob[]) {
        if (job.status === "FAILED") {
          result.scanned.failed_jobs++;
          await handleFailedJob(sb, job, result);
        } else if (job.status === "RUNNING") {
          result.scanned.stuck_jobs++;
          await handleStuckJob(sb, job, result);
        }
      }
    }
  } catch (err: any) {
    result.errors.push(`scan: ${err.message}`);
  }

  // ── 2. Scan for dead workers ──
  try {
    const cutoff = new Date(
      Date.now() - DEAD_WORKER_THRESHOLD_MIN * 60_000,
    ).toISOString();

    const { data: deadWorkers } = await sb
      .from("buddy_workers" as any)
      .select("id, worker_type, last_heartbeat_at, consecutive_failures")
      .eq("status", "alive")
      .lt("last_heartbeat_at", cutoff);

    for (const w of (deadWorkers ?? []) as any[]) {
      result.scanned.dead_workers++;

      await sb
        .from("buddy_workers" as any)
        .update({ status: "dead", updated_at: new Date().toISOString() } as any)
        .eq("id", w.id);

      writeSystemEvent({
        event_type: "stuck_job",
        severity: "warning",
        source_system: "observer",
        error_class: "timeout",
        error_message: `Worker ${w.id} (${w.worker_type}) has not sent heartbeat for ${DEAD_WORKER_THRESHOLD_MIN}+ minutes`,
        payload: {
          worker_id: w.id,
          worker_type: w.worker_type,
          last_heartbeat: w.last_heartbeat_at,
        },
      }).catch(() => {});

      result.actions.workers_marked_dead++;
      result.actions.events_emitted++;
    }
  } catch (err: any) {
    result.errors.push(`dead_workers: ${err.message}`);
  }

  // ── 3. Emit observer's own heartbeat ──
  writeSystemEvent({
    event_type: "heartbeat",
    severity: "info",
    source_system: "observer",
    resolution_status: "resolved",
    payload: { ...result.scanned, ...result.actions },
  }).catch(() => {});

  return result;
}

/* ------------------------------------------------------------------ */
/*  Internal handlers                                                  */
/* ------------------------------------------------------------------ */

async function handleFailedJob(
  sb: ReturnType<typeof supabaseAdmin>,
  job: UnifiedJob,
  result: ObserverTickResult,
): Promise<void> {
  const classified = classifyError(new Error(job.error ?? "Unknown failure"));
  const table = job.source_table as AegisJobTable;

  if (isRetryable(classified.errorClass) && job.attempt < MAX_AUTO_RETRY) {
    // Auto-retry: reset job to QUEUED with exponential backoff
    const backoffMs = calculateBackoffMs(classified.errorClass, job.attempt);
    const nextRunAt = new Date(Date.now() + backoffMs).toISOString();

    await sb
      .from(table as any)
      .update({
        status: "QUEUED",
        next_run_at: nextRunAt,
        error: `[observer-retry] ${job.error}`,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", job.job_id);

    writeSystemEvent({
      event_type: "retry",
      severity: "info",
      error_signature: classified.fingerprint,
      source_system: "observer",
      source_job_id: job.job_id,
      source_job_table: table,
      deal_id: job.deal_id,
      bank_id: job.bank_id ?? undefined,
      error_class: classified.errorClass,
      error_code: classified.errorCode,
      error_message: classified.errorMessage,
      resolution_status: "retrying",
      retry_attempt: job.attempt,
      max_retries: MAX_AUTO_RETRY,
      next_retry_at: nextRunAt,
    }).catch(() => {});

    result.actions.retried++;
  } else {
    // Permanent failure or max retries exhausted — mark dead
    writeSystemEvent({
      event_type: "error",
      severity: classified.errorClass === "permanent" ? "error" : "critical",
      error_signature: classified.fingerprint,
      source_system: "observer",
      source_job_id: job.job_id,
      source_job_table: table,
      deal_id: job.deal_id,
      bank_id: job.bank_id ?? undefined,
      error_class: classified.errorClass,
      error_code: classified.errorCode,
      error_message: classified.errorMessage,
      resolution_status: "dead",
      retry_attempt: job.attempt,
      max_retries: job.max_attempts,
      payload: {
        observer_verdict: isRetryable(classified.errorClass)
          ? "max_retries_exceeded"
          : "permanent_failure",
      },
    }).catch(() => {});

    result.actions.marked_dead++;
  }

  result.actions.events_emitted++;
}

async function handleStuckJob(
  sb: ReturnType<typeof supabaseAdmin>,
  job: UnifiedJob,
  result: ObserverTickResult,
): Promise<void> {
  const table = job.source_table as AegisJobTable;

  // Release the lease and re-queue
  await sb
    .from(table as any)
    .update({
      status: "QUEUED",
      leased_until: null,
      lease_owner: null,
      error: `[observer] lease expired after ${Math.round(job.minutes_stuck)}min stuck`,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", job.job_id);

  writeSystemEvent({
    event_type: "lease_expired",
    severity: "warning",
    source_system: "observer",
    source_job_id: job.job_id,
    source_job_table: table,
    deal_id: job.deal_id,
    bank_id: job.bank_id ?? undefined,
    error_class: "timeout",
    error_message: `Job stuck for ${Math.round(job.minutes_stuck)} minutes, lease released`,
    resolution_status: "retrying",
    payload: {
      minutes_stuck: job.minutes_stuck,
      previous_lease_owner: job.leased_until,
    },
  }).catch(() => {});

  result.actions.retried++;
  result.actions.events_emitted++;
}
