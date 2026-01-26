/**
 * Response Boundary Sealing Utility
 *
 * CRITICAL: This module ensures NOTHING can throw after the response is created.
 * All JSON serialization happens inside a sealed try/catch that always returns HTTP 200.
 *
 * Pattern:
 * 1. Build payload as plain JS objects (no Error instances, no BigInt, no circular refs)
 * 2. Call respond200() ONCE at the end of the handler
 * 3. respond200() handles all serialization errors internally
 *
 * NEVER:
 * - Return NextResponse.json() directly in multiple branches
 * - Await anything AFTER creating the response
 * - Include raw Error objects in payloads
 */
import "server-only";

import { NextResponse } from "next/server";
import { jsonSafe, sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";

// Re-export from envelope for convenience
export { makeCorrelationId, safeWithTimeout, validateUuidParam, validateStringParam } from "./envelope";

/**
 * Sealed response headers type.
 */
export interface SealedResponseHeaders {
  "x-correlation-id": string;
  "x-buddy-route": string;
  "cache-control"?: string;
}

/**
 * Create sealed response headers.
 */
export function createHeaders(correlationId: string, route: string): SealedResponseHeaders {
  return {
    "x-correlation-id": correlationId,
    "x-buddy-route": route,
    "cache-control": "no-store, max-age=0",
  };
}

/**
 * SEALED RESPONDER: Create HTTP 200 JSON response with guaranteed serialization safety.
 *
 * This function NEVER throws. If serialization fails, it returns a minimal safe response.
 *
 * @param payload - Plain JS object to serialize (will be passed through jsonSafe)
 * @param headers - Required headers including x-correlation-id and x-buddy-route
 */
export function respond200(
  payload: Record<string, unknown>,
  headers: SealedResponseHeaders
): NextResponse {
  // Attempt to serialize the payload safely
  let jsonString: string;
  try {
    const safePayload = jsonSafe(payload);
    jsonString = JSON.stringify(safePayload);
  } catch (serializeErr) {
    // Serialization failed - return minimal safe fallback
    console.error(
      `[respond200] correlationId=${headers["x-correlation-id"]} route=${headers["x-buddy-route"]} error=serialization_failed`,
      sanitizeErrorForEvidence(serializeErr)
    );

    // Extract what we can from the payload for the fallback
    const correlationId = headers["x-correlation-id"];
    const ts = new Date().toISOString();

    const fallback = {
      ok: false,
      error: {
        code: "serialization_error",
        message: "Response serialization failed",
        correlationId,
      },
      meta: {
        correlationId,
        ts,
        route: headers["x-buddy-route"],
      },
    };

    // This is guaranteed safe since fallback contains only primitives
    jsonString = JSON.stringify(fallback);
  }

  // Create response with pre-serialized JSON
  // Using Response directly to avoid any NextResponse internal processing
  return new NextResponse(jsonString, {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

/**
 * SEALED ENVELOPE RESPONDER: Create HTTP 200 JSON response with standard envelope shape.
 *
 * Supports custom data keys (deal, state, context, etc.) while maintaining
 * the standard envelope contract.
 *
 * @param envelope - Envelope with ok, dataKey, data, optional error, and meta
 * @param headers - Required headers
 */
export function respond200Envelope<T>(
  envelope: {
    ok: boolean;
    dataKey: string;
    data: T;
    error?: { code: string; message: string };
    meta: { dealId: string; correlationId: string; ts: string };
  },
  headers: SealedResponseHeaders
): NextResponse {
  // Build payload with custom data key
  const payload: Record<string, unknown> = {
    ok: envelope.ok,
    [envelope.dataKey]: envelope.data,
    meta: envelope.meta,
  };

  if (envelope.error) {
    payload.error = {
      ...envelope.error,
      correlationId: envelope.meta.correlationId,
    };
  }

  return respond200(payload, headers);
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
    message: (info.message || "An unexpected error occurred").slice(0, 500),
  };
}

/**
 * Generate a correlation ID for request tracing.
 * Format: {prefix}-{timestamp_base36}-{random_6chars}
 */
export function generateCorrelationId(prefix: string = "api"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a standard timestamp for meta.
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}
