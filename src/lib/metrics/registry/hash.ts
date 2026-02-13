/**
 * Phase 12 — Canonical Registry Hashing
 *
 * Deterministic serialization + SHA-256 for metric registry entries.
 * Strips non-semantic fields (timestamps, UUIDs, comments) so that
 * semantically identical registries always produce the same hash.
 */

import { createHash } from "node:crypto";

/**
 * Fields stripped from canonical serialization (non-semantic / volatile).
 */
const STRIP_FIELDS = new Set([
  "id",
  "registry_version_id",
  "created_at",
  "updated_at",
  "published_at",
  "created_by",
  "definition_hash",
]);

/**
 * Recursively sort object keys and strip non-semantic fields.
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
 * Canonical JSON of a single metric definition entry.
 * Strips non-semantic fields and sorts keys deterministically.
 */
export function canonicalizeEntryJson(definitionJson: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(definitionJson));
}

/**
 * SHA-256 hash of a single entry's canonical JSON.
 */
export function hashEntry(definitionJson: Record<string, unknown>): string {
  const json = canonicalizeEntryJson(definitionJson);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * Canonical JSON serialization of an entire registry version's entries.
 *
 * Entries are sorted by metric_key for deterministic ordering.
 * Each entry's definition_json is canonicalized (sorted keys, stripped fields).
 */
export function canonicalizeRegistryJson(
  entries: Array<{ metric_key: string; definition_json: Record<string, unknown> }>,
): string {
  const sorted = [...entries].sort((a, b) => a.metric_key.localeCompare(b.metric_key));
  const canonical = sorted.map((e) => ({
    metric_key: e.metric_key,
    definition: canonicalize(e.definition_json),
  }));
  return JSON.stringify(canonical);
}

/**
 * SHA-256 content hash for a full registry version.
 * This is the value stored in metric_registry_versions.content_hash
 * and deal_model_snapshots.registry_content_hash.
 */
export function hashRegistry(
  entries: Array<{ metric_key: string; definition_json: Record<string, unknown> }>,
): string {
  const json = canonicalizeRegistryJson(entries);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * SHA-256 hash of canonical outputs (for replay determinism proof).
 */
export function hashOutputs(outputs: unknown): string {
  const json = JSON.stringify(canonicalize(outputs));
  return createHash("sha256").update(json, "utf8").digest("hex");
}
