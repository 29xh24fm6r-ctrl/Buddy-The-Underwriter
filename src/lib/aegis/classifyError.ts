import "server-only";

import { computeFingerprint } from "@/lib/telemetry/observerEvents";
import type { AegisErrorClass } from "./types";

export interface ClassifiedError {
  errorClass: AegisErrorClass;
  errorCode: string;
  errorMessage: string;
  errorStack: string | null;
  fingerprint: string;
}

/**
 * Classify an error into an AegisErrorClass to determine retry strategy.
 *
 * Classification priority: auth → quota → timeout → schema → transient → permanent → unknown
 */
export function classifyError(err: unknown): ClassifiedError {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = e.message.toLowerCase();
  const stack = e.stack?.slice(0, 800) ?? null;

  let errorClass: AegisErrorClass = "unknown";
  let errorCode = "UNKNOWN";

  // Auth failures
  if (
    msg.includes("default credentials") ||
    msg.includes("workload identity") ||
    msg.includes("gcp_wif") ||
    msg.includes("unauthorized") ||
    msg.includes("auth_not_configured") ||
    msg.includes("forbidden")
  ) {
    errorClass = "auth";
    errorCode = "AUTH_FAILED";
  }
  // Quota / rate limits
  else if (
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("429") ||
    msg.includes("rate_limit") ||
    msg.includes("too many requests")
  ) {
    errorClass = "quota";
    errorCode = "QUOTA_EXCEEDED";
  }
  // Timeouts
  else if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("deadline") ||
    msg.includes("aborted") ||
    msg.includes("econnaborted")
  ) {
    errorClass = "timeout";
    errorCode = "TIMEOUT";
  }
  // Schema mismatch
  else if (
    msg.includes("column") &&
    msg.includes("does not exist")
  ) {
    errorClass = "schema";
    errorCode = "SCHEMA_MISMATCH";
  }
  // Network transient
  else if (
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("socket hang up") ||
    msg.includes("503") ||
    msg.includes("502")
  ) {
    errorClass = "transient";
    errorCode = "NETWORK_ERROR";
  }
  // Permanent data errors
  else if (
    msg.includes("not found") ||
    msg.includes("invalid") ||
    msg.includes("malformed") ||
    msg.includes("parse error")
  ) {
    errorClass = "permanent";
    errorCode = "DATA_ERROR";
  }

  const fingerprint = computeFingerprint({
    severity: "error",
    type: "service.error",
    stage: errorCode,
    message: e.message,
    error: { name: e.name, message: e.message },
  });

  return {
    errorClass,
    errorCode,
    errorMessage: e.message.slice(0, 1000),
    errorStack: stack,
    fingerprint,
  };
}

/** Determine if error class is worth retrying. */
export function isRetryable(errorClass: AegisErrorClass): boolean {
  return (
    errorClass === "transient" ||
    errorClass === "quota" ||
    errorClass === "timeout"
  );
}

/** Calculate backoff for retry based on error class and attempt number. */
export function calculateBackoffMs(
  errorClass: AegisErrorClass,
  attempt: number,
): number {
  // Quota: 2min base (back off longer to let quotas recover)
  // Others: 30s base
  const base = errorClass === "quota" ? 120_000 : 30_000;
  return Math.min(base * Math.pow(2, attempt), 3_600_000); // Max 1 hour
}
