/**
 * Safe JSON parsing and UploadResult validation utilities
 * 
 * Never throw in render. Never assume nested fields exist.
 * All parsing is defensive with runtime guards.
 */

import type { UploadResult, UploadOk, UploadErr } from "./types";

/**
 * Safe JSON read from Response (no throw)
 * Returns null if parse fails or body is missing
 */
export async function readJson<T>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (e) {
    console.warn("[upload] failed to parse response JSON", e);
    return null;
  }
}

/**
 * Convert unknown error to canonical UploadErr
 * Handles: Error objects, strings, fetch failures, unknown types
 */
export function toUploadErr(e: unknown, requestId?: string): UploadErr {
  if (e instanceof Error) {
    return {
      ok: false,
      error: e.message || "Upload failed",
      code: e.name || "UNKNOWN_ERROR",
      details: e.stack,
      request_id: requestId,
    };
  }

  if (typeof e === "string") {
    return {
      ok: false,
      error: e || "Upload failed",
      request_id: requestId,
    };
  }

  if (e && typeof e === "object" && "error" in e) {
    return {
      ok: false,
      error: String((e as any).error) || "Upload failed",
      code: (e as any).code,
      details: (e as any).details,
      request_id: requestId,
    };
  }

  return {
    ok: false,
    error: "Upload failed",
    code: "UNKNOWN_ERROR",
    details: String(e),
    request_id: requestId,
  };
}

/**
 * Runtime guard: verify response is valid UploadOk
 * Returns typed UploadOk or null (safe for render)
 */
export function assertUploadOk(x: any): UploadOk | null {
  if (!x || typeof x !== "object") return null;
  if (x.ok !== true) return null;
  if (typeof x.file_id !== "string" || !x.file_id) return null;

  return {
    ok: true,
    file_id: x.file_id,
    checklist_key: x.checklist_key ?? null,
    meta: x.meta || {},
  };
}

/**
 * Runtime guard: verify response is UploadResult
 * Coerces malformed responses to UploadErr
 */
export function assertUploadResult(x: any): UploadResult {
  if (!x || typeof x !== "object") {
    return { ok: false, error: "Invalid response format" };
  }

  if (x.ok === true) {
    const valid = assertUploadOk(x);
    return valid || { ok: false, error: "Missing file_id in success response" };
  }

  return {
    ok: false,
    error: x.error || x.message || "Upload failed",
    code: x.code,
    details: x.details,
    request_id: x.request_id,
  };
}

/**
 * Generate correlation ID for request tracking
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
