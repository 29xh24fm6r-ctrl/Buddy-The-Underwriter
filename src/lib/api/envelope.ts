/**
 * Bank-Grade API Envelope Utility
 *
 * Standardizes the "Never 500" pattern across all critical API routes.
 * Every response uses this envelope structure for consistency and debuggability.
 *
 * Usage:
 *   return respond200({ ok: true, data: myData }, correlationId);
 *   return respond200({ ok: false, error: { code: "not_found", message: "Deal not found" } }, correlationId);
 */

import { NextResponse } from "next/server";
import { jsonSafe, sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";

/**
 * Standard API envelope structure.
 * All critical endpoints return this shape with HTTP 200.
 */
export type ApiEnvelope<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    correlationId?: string;
  };
  meta: {
    correlationId: string;
    ts: string;
    /** Optional: source route for debugging */
    source?: string;
  };
};

/**
 * Generate a correlation ID for request tracing.
 * Format: {prefix}-{timestamp_base36}-{random_6chars}
 *
 * @param prefix - Short prefix identifying the route (e.g., "ctx", "lc", "snap")
 */
export function makeCorrelationId(prefix: string = "api"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sanitize an error for safe inclusion in API response.
 * Never exposes stack traces or internal details to clients.
 */
export function sanitizeError(
  err: unknown,
  code: string = "internal_error"
): { code: string; message: string } {
  const info = sanitizeErrorForEvidence(err);
  return {
    code,
    message: info.message || "An unexpected error occurred",
  };
}

/**
 * Create a standard HTTP 200 JSON response with correlation headers.
 *
 * NEVER returns 500 - errors are represented in the response body.
 *
 * @param body - The response body (will be JSON-safe serialized)
 * @param correlationId - Request correlation ID for tracing
 * @param source - Optional source identifier for debugging
 */
export function respond200<T>(
  body: {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string };
  },
  correlationId: string,
  source?: string
): NextResponse {
  const ts = new Date().toISOString();

  const envelope: ApiEnvelope<T> = {
    ok: body.ok,
    ...(body.data !== undefined && { data: body.data }),
    ...(body.error && {
      error: {
        ...body.error,
        correlationId,
      },
    }),
    meta: {
      correlationId,
      ts,
      ...(source && { source }),
    },
  };

  try {
    const safeBody = jsonSafe(envelope);
    return NextResponse.json(safeBody, {
      status: 200,
      headers: {
        "x-correlation-id": correlationId,
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (serializationErr) {
    // Even serialization failed - return minimal safe response
    console.error(
      `[api/envelope] correlationId=${correlationId} source=${source ?? "unknown"} error=serialization_failed`
    );
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "serialization_error",
          message: "Failed to serialize response",
          correlationId,
        },
        meta: { correlationId, ts, source },
      },
      {
        status: 200,
        headers: {
          "x-correlation-id": correlationId,
          "cache-control": "no-store, max-age=0",
        },
      }
    );
  }
}

/**
 * Timeout helper that doesn't throw - returns result or error object.
 *
 * @param promise - The promise to race against timeout
 * @param ms - Timeout in milliseconds
 * @param label - Label for logging on timeout
 * @param correlationId - Correlation ID for logging
 */
export async function safeWithTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
  correlationId: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const result = await Promise.race<T | "TIMEOUT">([
      Promise.resolve(promise),
      new Promise<"TIMEOUT">((resolve) => setTimeout(() => resolve("TIMEOUT"), ms)),
    ]);
    if (result === "TIMEOUT") {
      console.warn(`[api/envelope] correlationId=${correlationId} timeout=${label} ms=${ms}`);
      return { ok: false, error: `timeout:${label}` };
    }
    return { ok: true, data: result };
  } catch (err) {
    const errInfo = sanitizeErrorForEvidence(err);
    console.warn(
      `[api/envelope] correlationId=${correlationId} error=${label}: ${errInfo.message}`
    );
    return { ok: false, error: errInfo.message };
  }
}

/**
 * Extract a validated string parameter from route params.
 * Returns error object if invalid.
 */
export function validateStringParam(
  value: unknown,
  name: string
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${name} must be a string` };
  }
  if (!value || value === "undefined" || value === "null") {
    return { ok: false, error: `${name} is empty or invalid` };
  }
  return { ok: true, value };
}

/**
 * Validate UUID-like string (loose check for dealId, etc.)
 */
export function validateUuidParam(
  value: unknown,
  name: string = "id"
): { ok: true; value: string } | { ok: false; error: string } {
  const stringCheck = validateStringParam(value, name);
  if (!stringCheck.ok) return stringCheck;

  // Loose UUID format check
  if (stringCheck.value.length < 10 || stringCheck.value.length > 50) {
    return { ok: false, error: `${name} has invalid length` };
  }
  return { ok: true, value: stringCheck.value };
}
