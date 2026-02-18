/**
 * OpenAI Resilience Layer — Trace IDs + Retry + Circuit Breaker
 *
 * Canonical infrastructure for all OpenAI API calls in Buddy.
 *
 * Invariants:
 * - Every request attempt carries X-Client-Request-Id (per-attempt) and X-Buddy-Trace-Id (per-operation)
 * - Retry: bounded backoff [250, 500, 1000, 2000, 4000] ms with ±20% jitter
 * - Circuit breaker: per-instance, opens after 10 consecutive retryable failures, 45s cooldown
 * - SDK retry disabled; Buddy owns the retry loop
 */

import crypto from "node:crypto";

// ─── Constants ───────────────────────────────────────────────────────────────

const BACKOFF_SCHEDULE_MS = [250, 500, 1000, 2000, 4000];
const JITTER_FACTOR = 0.2; // ±20%
const DEFAULT_MAX_RETRIES = 5;

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

const NETWORK_ERROR_PATTERNS = [
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "timeout",
  "network",
  "fetch failed",
];

// ─── Trace IDs ───────────────────────────────────────────────────────────────

export type TraceIds = {
  /** Stable per logical operation — same across retries. */
  traceId: string;
  /** Fresh per attempt — used for X-Client-Request-Id. */
  attemptId: string;
};

export function makeTraceIds(): TraceIds {
  return {
    traceId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
  };
}

// ─── Error Classification ────────────────────────────────────────────────────

/**
 * Determine if an OpenAI error is retryable.
 *
 * Retryable: 500, 502, 503, 504, timeout/network errors (no status).
 * Non-retryable: 400, 401, 403, 404, 422, 429, schema errors.
 */
export function isRetryableOpenAIError(err: unknown): boolean {
  if (!err) return false;

  const status = (err as any)?.status ?? (err as any)?.statusCode;

  // Explicit HTTP status → check retryable set
  if (typeof status === "number") {
    return RETRYABLE_STATUSES.has(status);
  }

  // No HTTP status → check for timeout/network error patterns
  const msg = String(
    (err as any)?.message ?? (err as any)?.code ?? "",
  ).toLowerCase();

  return NETWORK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

// ─── Circuit Breaker (per-instance) ──────────────────────────────────────────

export type BreakerState = "closed" | "open" | "half-open";

export class OpenAICircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(threshold = 10, cooldownMs = 45_000) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }

  get state(): BreakerState {
    if (Date.now() < this.openUntil) return "open";
    if (this.consecutiveFailures >= this.threshold) return "half-open";
    return "closed";
  }

  /**
   * Check if circuit is passable. Throws OPENAI_CIRCUIT_OPEN if breaker is open.
   * In half-open state, allows one probe request through.
   */
  check(): void {
    if (this.state === "open") {
      const remainingSec = Math.ceil(
        (this.openUntil - Date.now()) / 1000,
      );
      const err = new Error(
        `OpenAI circuit breaker OPEN — ${remainingSec}s remaining`,
      );
      (err as any).code = "OPENAI_CIRCUIT_OPEN";
      throw err;
    }
    // half-open or closed: allow request through
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.threshold && this.state !== "open") {
      this.openUntil = Date.now() + this.cooldownMs;
      console.error(
        `[OpenAI] Circuit breaker OPENED after ${this.consecutiveFailures} consecutive failures. Cooldown: ${this.cooldownMs}ms.`,
      );
    }
  }

  /** Reset for testing. */
  _reset(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }
}

/** Per-instance singleton breaker for all OpenAI calls. */
export const openAICircuitBreaker = new OpenAICircuitBreaker();

// ─── Retry Wrapper ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Canonical OpenAI resilience wrapper.
 *
 * - Generates stable traceId once per call
 * - Each attempt: fresh attemptId, check breaker, call fn, record outcome
 * - Retries only on isRetryableOpenAIError with bounded backoff + jitter
 * - Logs each attempt for observability
 */
export async function withOpenAIResilience<T>(
  tag: string,
  fn: (ids: TraceIds) => Promise<T>,
  opts?: { maxRetries?: number },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const traceId = crypto.randomUUID();

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptId = crypto.randomUUID();
    const ids: TraceIds = { traceId, attemptId };

    try {
      // Check circuit breaker before each attempt
      openAICircuitBreaker.check();

      const result = await fn(ids);

      openAICircuitBreaker.recordSuccess();
      return result;
    } catch (err: any) {
      lastError = err;

      // Circuit breaker open → don't retry, propagate immediately
      if (err?.code === "OPENAI_CIRCUIT_OPEN") {
        throw err;
      }

      const retryable = isRetryableOpenAIError(err);
      const status = err?.status ?? err?.statusCode ?? "N/A";

      if (!retryable || attempt === maxRetries) {
        // Non-retryable or exhausted retries
        if (retryable) {
          openAICircuitBreaker.recordFailure();
        }

        console.error(`[OpenAI] ${tag} FAILED (attempt ${attempt + 1}/${maxRetries + 1})`, {
          status,
          message: err?.message,
          traceId,
          attemptId,
          breakerState: openAICircuitBreaker.state,
          retryable,
        });

        throw err;
      }

      // Retryable failure — record, backoff, retry
      openAICircuitBreaker.recordFailure();

      const scheduleIdx = Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1);
      const baseMs = BACKOFF_SCHEDULE_MS[scheduleIdx];
      const jitter = baseMs * JITTER_FACTOR * (2 * Math.random() - 1);
      const delayMs = Math.max(0, Math.round(baseMs + jitter));

      console.warn(`[OpenAI] ${tag} attempt ${attempt + 1}/${maxRetries + 1} failed (${status}), retrying in ${delayMs}ms`, {
        traceId,
        attemptId,
        breakerState: openAICircuitBreaker.state,
      });

      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
