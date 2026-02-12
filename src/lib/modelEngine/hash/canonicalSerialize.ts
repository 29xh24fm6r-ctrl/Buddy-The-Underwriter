/**
 * Model Engine V2 — Canonical Serialization
 *
 * Deterministic serialization for financial models:
 * - Stable key ordering (sorted alphabetically)
 * - Stable array ordering (preserved)
 * - Non-deterministic fields stripped (timestamps, random IDs)
 * - SHA-256 hash for audit trail
 */

import { createHash } from "node:crypto";

// Fields to strip from serialization (non-deterministic)
const STRIP_FIELDS = new Set(["generatedAt", "calculatedAt", "computedAt", "created_at", "updated_at"]);

/**
 * Recursively sort object keys and strip non-deterministic fields.
 */
function canonicalize(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(canonicalize);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(val as Record<string, unknown>).sort()) {
    if (STRIP_FIELDS.has(key)) continue;
    sorted[key] = canonicalize((val as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Canonical JSON serialization with sorted keys and stripped non-deterministic fields.
 * Produces identical output for semantically identical inputs regardless of key order.
 */
export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * SHA-256 hash of canonical serialization.
 */
export function canonicalHash(value: unknown): string {
  const json = canonicalSerialize(value);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * Hash a FinancialModel for audit trail.
 * Strips non-deterministic fields before hashing.
 */
export function hashFinancialModel(
  model: import("../types").FinancialModel,
): string {
  return canonicalHash(model);
}
