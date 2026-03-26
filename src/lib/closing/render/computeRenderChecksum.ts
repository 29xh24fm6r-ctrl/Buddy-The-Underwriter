/**
 * Phase 56C.1 — Render Checksum
 *
 * Stable, deterministic checksums for render inputs and outputs.
 * Used for idempotency, diff detection, and audit lineage.
 */

import * as crypto from "node:crypto";

/**
 * Compute a stable checksum from a JSON-serializable object.
 * Sorts keys deterministically before hashing.
 */
export function computeInputChecksum(snapshot: Record<string, unknown>): string {
  const stable = stableStringify(snapshot);
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

/**
 * Compute checksum from raw file bytes.
 */
export function computeOutputChecksum(bytes: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/**
 * JSON.stringify with sorted keys for deterministic output.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";

  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sorted.map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`);
  return "{" + pairs.join(",") + "}";
}
