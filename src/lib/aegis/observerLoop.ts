import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "./writeSystemEvent";
import {
  classifyError,
  isRetryable,
  isNeverRetry,
  calculateBackoffMs,
} from "./classifyError";
import type {
  UnifiedJob,
  AegisJobTable,
  SystemicFailure,
  ObserverTickResult,
} from "./types";

const STUCK_THRESHOLD_MIN = 10;
const DEAD_WORKER_THRESHOLD_MIN = 15;
const MAX_AUTO_RETRY = 5;

// Systemic failure detection thresholds (tunable)
const SYSTEMIC_MIN_COUNT = 5;
const SYSTEMIC_MIN_ENTITIES = 3;
const SYSTEMIC_WINDOW_MINUTES = 60;

/**
 * Main observer tick — called by cron every 5 minutes.
 *
 * Phase 1: Scan stuck/failed jobs, auto-retry or mark dead
 * Phase 2 (hardening):
 *   - Systemic failure detection: same signature across N+ hits, M+ entities → suppress retries
 *   - Decision events: every observer action emits an explicit decision event
 *   - Derived failure age: computed for triage in payload
 *   - auth/schema/permanent errors are NEVER retried
 *   - Suppressed signatures skip retry entirely
 */
export async function runObserverTick(): Promise<ObserverTickResult> {
  const sb = supabaseAdmin();
  const result: ObserverTickResult = {
    ok: true,
    scanned: { stuck_jobs: 0, failed_jobs: 0, dead_workers: 0 },
    actions: {
      retried: 0,
      marked_dead: 0,
      suppressed: 0,
      workers_marked_dead: 0,
      systemic_failures_detected: 0,
      events_emitted: 0,
    },
    systemic_failures: [],
    errors: [],
  };

  // ── 0. Detect systemic failures FIRST (before processing individual jobs) ──
  const suppressedSignatures = new Set<string>();
  try {
    const { data: systemicRaw, error: sErr } = await sb.rpc(
      "detect_systemic_failures" as any,
      {
        p_min_count: SYSTEMIC_MIN_COUNT,
        p_min_entities: SYSTEMIC_MIN_ENTITIES,
        p_window_minutes: SYSTEMIC_WINDOW_MINUTES,
      },
    );

    if (sErr) {
      result.errors.push(`detect_systemic_failures: ${sErr.message}`);
    } else if (systemicRaw) {
      const systemicFailures = systemicRaw as unknown as SystemicFailure[];
      result.systemic_failures = systemicFailures;
      result.actions.systemic_failures_detected = systemicFailures.length;

      for (const sf of systemicFailures) {
        suppressedSignatures.add(sf.error_signature);

        // Emit ONE systemic failure detection event per signature
        writeSystemEvent({
          event_type: "suppressed",
          severity: sf.hit_count >= 20 ? "critical" : "error",
          error_signature: sf.error_signature,
          source_system: "observer",
          error_class: (sf.error_class as any) ?? "unknown",
          error_code: sf.error_code ?? undefined,
          error_message: `Systemic failure detected: ${sf.hit_count} hits across ${sf.distinct_entities} entities — retries suppressed`,
          resolution_status: "suppressed",
          payload: {
            observer_decision: "systemic_failure_detected",
            hit_count: sf.hit_count,
            distinct_entities: sf.distinct_entities,
            first_seen_at: sf.first_seen_at,
            last_seen_at: sf.last_seen_at,
            sample_message: sf.sample_message?.slice(0, 200),
          },
        }).catch(() => {});

        result.actions.events_emitted++;

        // Suppress all open/retrying events with this signature
        await sb
          .from("buddy_system_events" as any)
          .update({
            resolution_status: "suppressed",
            resolution_note: `Systemic failure: ${sf.hit_count} hits, ${sf.distinct_entities} entities`,
          } as any)
          .eq("error_signature", sf.error_signature)
          .in("resolution_status", ["open", "retrying"]);
      }
    }
  } catch (err: any) {
    result.errors.push(`systemic_detection: ${err.message}`);
  }

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
          await handleFailedJob(sb, job, result, suppressedSignatures);
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
        .update({
          status: "dead",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", w.id);

      writeSystemEvent({
        event_type: "stuck_job",
        severity: "warning",
        source_system: "observer",
        error_class: "timeout",
        error_message: `Worker ${w.id} (${w.worker_type}) has not sent heartbeat for ${DEAD_WORKER_THRESHOLD_MIN}+ minutes`,
        resolution_status: "open",
        payload: {
          observer_decision: "worker_marked_dead",
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
    payload: {
      ...result.scanned,
      ...result.actions,
      systemic_signatures: [...suppressedSignatures],
    },
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
  suppressedSignatures: Set<string>,
): Promise<void> {
  const classified = classifyError(new Error(job.error ?? "Unknown failure"));
  const table = job.source_table as AegisJobTable;

  // Derived failure age (minutes since job last updated)
  const failureAgeMin = job.minutes_stuck;

  // ── Decision: Is this signature suppressed (systemic outage)? ──
  if (suppressedSignatures.has(classified.fingerprint)) {
    writeSystemEvent({
      event_type: "suppressed",
      severity: "warning",
      error_signature: classified.fingerprint,
      source_system: "observer",
      source_job_id: job.job_id,
      source_job_table: table,
      deal_id: job.deal_id,
      bank_id: job.bank_id ?? undefined,
      error_class: classified.errorClass,
      error_code: classified.errorCode,
      error_message: classified.errorMessage,
      resolution_status: "suppressed",
      retry_attempt: job.attempt,
      payload: {
        observer_decision: "retry_suppressed",
        reason: "systemic_failure_active",
        failure_age_min: failureAgeMin,
      },
    }).catch(() => {});

    result.actions.suppressed++;
    result.actions.events_emitted++;
    return;
  }

  // ── Decision: Is this error class never-retry? ──
  if (isNeverRetry(classified.errorClass)) {
    writeSystemEvent({
      event_type: "error",
      severity: classified.errorClass === "auth" ? "critical" : "error",
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
      resolved_at: new Date().toISOString(),
      resolved_by: "observer",
      resolution_note: `${classified.errorClass} errors are never retried`,
      retry_attempt: job.attempt,
      max_retries: job.max_attempts,
      payload: {
        observer_decision: "job_marked_dead",
        reason: `never_retry_${classified.errorClass}`,
        failure_age_min: failureAgeMin,
      },
    }).catch(() => {});

    result.actions.marked_dead++;
    result.actions.events_emitted++;
    return;
  }

  // ── Decision: Retryable and under max attempts? ──
  if (isRetryable(classified.errorClass) && job.attempt < MAX_AUTO_RETRY) {
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
      payload: {
        observer_decision: "retry_scheduled",
        backoff_ms: backoffMs,
        failure_age_min: failureAgeMin,
      },
    }).catch(() => {});

    result.actions.retried++;
  } else {
    // Max retries exhausted or unknown error class → mark dead
    writeSystemEvent({
      event_type: "error",
      severity: "critical",
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
      resolved_at: new Date().toISOString(),
      resolved_by: "observer",
      resolution_note: isRetryable(classified.errorClass)
        ? "Max retries exceeded"
        : `${classified.errorClass} — not retryable`,
      retry_attempt: job.attempt,
      max_retries: job.max_attempts,
      payload: {
        observer_decision: "job_marked_dead",
        reason: isRetryable(classified.errorClass)
          ? "max_retries_exceeded"
          : "not_retryable",
        failure_age_min: failureAgeMin,
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
      observer_decision: "lease_released",
      minutes_stuck: job.minutes_stuck,
      previous_lease_owner: job.leased_until,
    },
  }).catch(() => {});

  result.actions.retried++;
  result.actions.events_emitted++;
}
