/**
 * Canonical error-payload detector for extraction results.
 *
 * classifyDocument() swallows API errors and returns { error: "..." } as
 * rawExtraction.  This helper detects that shape so callers can route to
 * mark_artifact_failed instead of persisting garbage data.
 *
 * Pure functions — safe to call from any context (server, test, edge).
 */

/**
 * Returns true when `payload` looks like an error envelope produced by
 * a failed upstream call (e.g. Anthropic billing error stored as data).
 *
 * Detection rules:
 *  1. Must be a non-null object.
 *  2. Must contain a top-level `error` key whose value is a non-empty string.
 *  3. Must have no other keys with meaningful (non-null, non-empty) values.
 */
export function isExtractionErrorPayload(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const obj = payload as Record<string, unknown>;

  // Must have an `error` string key
  if (!("error" in obj) || typeof obj.error !== "string" || obj.error === "") {
    return false;
  }

  // Check whether any *other* key carries a meaningful value
  const meaningfulKeys = Object.keys(obj).filter((k) => {
    if (k === "error") return false;
    const v = obj[k];
    return v != null && v !== "" && v !== false;
  });

  // Pure error envelope → no other meaningful keys
  return meaningfulKeys.length === 0;
}

/**
 * Extract a human-readable error message from an error payload.
 * Returns a truncated string suitable for error_message columns.
 */
export function extractErrorMessage(payload: unknown): string {
  if (payload == null || typeof payload !== "object") return "unknown error";
  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.length > 0) {
    return obj.error.slice(0, 2000);
  }
  return JSON.stringify(payload).slice(0, 200);
}
