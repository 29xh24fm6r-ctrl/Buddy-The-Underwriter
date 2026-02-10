import "server-only";

import { writeSystemEvent } from "./writeSystemEvent";
import { classifyError, isRetryable } from "./classifyError";
import { sendHeartbeat, recordJobCompletion } from "./workerHeartbeat";
import { emitObserverEvent } from "@/lib/telemetry/observerEvents";
import type { AegisSourceSystem, AegisJobTable } from "./types";

interface BuddyGuardContext {
  jobId?: string;
  dealId?: string;
  bankId?: string;
  correlationId?: string;
}

interface BuddyGuardOptions {
  /** Which processor/system this wraps */
  source: AegisSourceSystem;
  /** Which job table the source job lives in (if applicable) */
  jobTable?: AegisJobTable;
  /** Extract context from the wrapped function's arguments */
  getContext?: (...args: any[]) => BuddyGuardContext;
}

/**
 * Wraps an async processor function with Aegis observability.
 *
 * - On success: records job completion, optionally writes success event
 * - On handled failure (fn returns { ok: false, error }): classifies error, writes system event
 * - On unhandled throw: classifies, writes system event, emits to Pulse, re-throws
 * - Always: sends worker heartbeat at start
 *
 * CRITICAL: Never alters the return value or error propagation of the wrapped function.
 * The wrapped function's own retry logic (exponential backoff in the processor) is preserved.
 * withBuddyGuard ONLY adds observability side-effects.
 */
export function withBuddyGuard<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  opts: BuddyGuardOptions,
): (...args: TArgs) => Promise<TReturn> {
  const workerId = `${opts.source}-${process.pid ?? "unknown"}`;

  return async (...args: TArgs): Promise<TReturn> => {
    const ctx = opts.getContext?.(...args) ?? {};
    const startMs = Date.now();

    // Heartbeat at start (fire-and-forget)
    sendHeartbeat({
      workerId,
      workerType: opts.source,
    }).catch(() => {});

    try {
      const result = await fn(...args);

      const durationMs = Date.now() - startMs;

      // Convention: processors return { ok: true/false, error?: string }
      const isOk =
        typeof result === "object" &&
        result !== null &&
        (result as any).ok === true;

      if (isOk) {
        recordJobCompletion(workerId, false).catch(() => {});
      } else {
        // Processor handled the failure internally (marked job FAILED/QUEUED for retry)
        // We still record it for Aegis observability
        const errorMsg =
          typeof result === "object" && result !== null
            ? (result as any).error
            : undefined;

        if (errorMsg) {
          const classified = classifyError(new Error(String(errorMsg)));

          writeSystemEvent({
            event_type: "error",
            severity: isRetryable(classified.errorClass) ? "warning" : "error",
            error_signature: classified.fingerprint,
            source_system: opts.source,
            source_job_id: ctx.jobId,
            source_job_table: opts.jobTable,
            deal_id: ctx.dealId,
            bank_id: ctx.bankId,
            error_class: classified.errorClass,
            error_code: classified.errorCode,
            error_message: classified.errorMessage,
            correlation_id: ctx.correlationId,
            resolution_status: isRetryable(classified.errorClass)
              ? "retrying"
              : "open",
            payload: { duration_ms: durationMs },
          }).catch(() => {});

          recordJobCompletion(workerId, true).catch(() => {});
        }
      }

      return result;
    } catch (err) {
      // Unhandled exception — the processor's own catch should have handled this,
      // but if we're wrapping the outer call, capture it for observability.
      const classified = classifyError(err);
      const durationMs = Date.now() - startMs;

      writeSystemEvent({
        event_type: "error",
        severity: "error",
        error_signature: classified.fingerprint,
        source_system: opts.source,
        source_job_id: ctx.jobId,
        source_job_table: opts.jobTable,
        deal_id: ctx.dealId,
        bank_id: ctx.bankId,
        error_class: classified.errorClass,
        error_code: classified.errorCode,
        error_message: classified.errorMessage,
        error_stack: classified.errorStack ?? undefined,
        correlation_id: ctx.correlationId,
        resolution_status: "open",
        payload: { duration_ms: durationMs, unhandled: true },
      }).catch(() => {});

      // Also emit to existing Pulse pipeline for external visibility
      emitObserverEvent({
        severity: "error",
        type: "service.error",
        deal_id: ctx.dealId,
        stage: opts.source,
        message: classified.errorMessage,
        error: {
          name: err instanceof Error ? err.name : "Error",
          message: classified.errorMessage,
          stack: classified.errorStack ?? undefined,
        },
        context: {
          job_id: ctx.jobId,
          error_class: classified.errorClass,
          source: "aegis",
        },
      }).catch(() => {});

      recordJobCompletion(workerId, true).catch(() => {});

      // Re-throw to preserve original error handling
      throw err;
    }
  };
}
