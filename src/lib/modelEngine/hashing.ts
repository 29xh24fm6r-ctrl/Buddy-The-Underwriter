/**
 * Model Engine V2 — Deterministic Hashing
 *
 * SHA-256 hash utility for audit trail:
 * - Metric registry hash (detect formula changes)
 * - Financial model hash (detect data changes)
 *
 * Deterministic serialization: JSON.stringify with sorted keys.
 */

import { createHash } from "node:crypto";

/**
 * Recursively sort object keys for deterministic serialization.
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Compute SHA-256 hash of any serializable value.
 * Keys are sorted for deterministic output.
 */
export function deterministicHash(value: unknown): string {
  const normalized = sortKeys(value);
  const json = JSON.stringify(normalized);
  return createHash("sha256").update(json, "utf8").digest("hex");
}
