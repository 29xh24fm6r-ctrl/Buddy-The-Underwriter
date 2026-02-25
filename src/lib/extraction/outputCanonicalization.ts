/**
 * Output Canonicalization + Hashing (B2).
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Normalizes structured output for deterministic hashing:
 * - Sorts keys recursively
 * - Normalizes numbers (strips trailing zeros)
 * - Strips null-only sections
 * - Produces deterministic SHA-256 output hash
 */

import { createHash } from "crypto";

// ── Normalization ───────────────────────────────────────────────────

/**
 * Normalize a structured JSON object for deterministic hashing.
 *
 * Rules:
 * 1. Sort all object keys recursively
 * 2. Normalize numbers (no trailing zeros)
 * 3. Strip null/undefined values
 * 4. Strip empty arrays
 * 5. Produces identical output for semantically identical inputs
 */
export function normalizeStructuredJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;

  if (typeof obj === "number") {
    // Normalize: NaN → null, Infinity → null, otherwise keep as-is
    if (!Number.isFinite(obj)) return undefined;
    return obj;
  }

  if (typeof obj === "string") return obj;
  if (typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    const normalized = obj
      .map(normalizeStructuredJson)
      .filter((v) => v !== undefined);
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    let hasValues = false;

    for (const key of keys) {
      const val = normalizeStructuredJson((obj as Record<string, unknown>)[key]);
      if (val !== undefined) {
        sorted[key] = val;
        hasValues = true;
      }
    }

    return hasValues ? sorted : undefined;
  }

  return undefined;
}

// ── Hashing ─────────────────────────────────────────────────────────

/**
 * Compute deterministic SHA-256 hash of normalized structured JSON.
 * Returns null if input normalizes to nothing (all nulls/empty).
 */
export function computeStructuredOutputHash(obj: unknown): string | null {
  const normalized = normalizeStructuredJson(obj);
  if (normalized === undefined) return null;

  const json = JSON.stringify(normalized);
  return createHash("sha256").update(json).digest("hex");
}
