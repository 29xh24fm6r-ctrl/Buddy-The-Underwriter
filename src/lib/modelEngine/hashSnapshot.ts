/**
 * Phase 12 — Full-State Snapshot Hash
 *
 * Distinct from outputsHash (metric-only). snapshot_hash captures:
 *   facts + financialModel + metrics + registry_version + policy_version
 *
 * Deterministic — excludes timestamps, DB IDs, generatedAt.
 * Uses canonicalHash (sorted keys, non-deterministic field stripping, SHA-256).
 */

import { canonicalHash } from "./hash/canonicalSerialize";

export interface SnapshotHashInput {
  facts: unknown;
  financialModel: unknown;
  metrics: unknown;
  registry_version: string;
  policy_version: string;
}

/**
 * Compute a deterministic hash of the full snapshot state.
 *
 * Inputs + outputs + version bindings → single SHA-256 hex string.
 */
export function computeSnapshotHash(input: SnapshotHashInput): string {
  return canonicalHash(input);
}
