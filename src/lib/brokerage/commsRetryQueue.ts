/**
 * Phase 11C — Comms Retry Queue
 *
 * Deterministic retry decision logic. No background worker — just
 * shapes the queue item for the caller to act on.
 */

import type { SendResult } from "@/lib/brokerage/commsAdapters";

export type RetryDecision = {
  shouldRetry: boolean;
  retryable: boolean;
  failureCode: string;
  attemptNumber: number;
  exhausted: boolean;
  nextDelaySec: number | null;
};

export const MAX_ATTEMPTS = 3;

// Exponential-ish backoff: 30s, 120s, 480s
function computeDelay(attempt: number): number {
  return Math.min(30 * Math.pow(4, attempt - 1), 600);
}

/**
 * Given a SendResult from a comms adapter, decide whether to retry.
 *
 * Retryable: 429, 5xx, network errors (retryable=true from adapter)
 * Non-retryable: 4xx, invalid E.164, missing opt-in, missing env
 */
export function normalizeSendResultToRetryDecision(
  result: SendResult,
  currentAttempt: number,
): RetryDecision {
  if (result.ok) {
    return {
      shouldRetry: false,
      retryable: false,
      failureCode: "",
      attemptNumber: currentAttempt,
      exhausted: false,
      nextDelaySec: null,
    };
  }

  const retryable = result.retryable === true;
  const exhausted = currentAttempt >= MAX_ATTEMPTS;

  if (!retryable) {
    return {
      shouldRetry: false,
      retryable: false,
      failureCode: result.error ?? "unknown",
      attemptNumber: currentAttempt,
      exhausted: false,
      nextDelaySec: null,
    };
  }

  if (exhausted) {
    return {
      shouldRetry: false,
      retryable: true,
      failureCode: result.error ?? "unknown",
      attemptNumber: currentAttempt,
      exhausted: true,
      nextDelaySec: null,
    };
  }

  return {
    shouldRetry: true,
    retryable: true,
    failureCode: result.error ?? "unknown",
    attemptNumber: currentAttempt,
    exhausted: false,
    nextDelaySec: computeDelay(currentAttempt),
  };
}

/**
 * Classify HTTP status codes for retry decisions.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function isNonRetryableStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}
