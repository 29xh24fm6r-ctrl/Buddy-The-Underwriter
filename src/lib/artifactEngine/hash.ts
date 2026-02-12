/**
 * Artifact Engine — Hashing
 *
 * Component-level and overall hash computation for underwrite artifacts.
 * Reuses deterministicHash() from modelEngine for SHA-256 with sorted keys.
 *
 * Timestamps (generatedAt, createdAt, etc.) are stripped before hashing
 * to ensure hash stability across runs with identical inputs.
 *
 * PHASE 7: Pure functions — no DB, no side effects.
 */

import { deterministicHash } from "@/lib/modelEngine/hashing";
import type { ArtifactHashes } from "./types";

// ---------------------------------------------------------------------------
// Timestamp stripping
// ---------------------------------------------------------------------------

const TIMESTAMP_KEYS = new Set(["generatedAt", "createdAt", "updatedAt"]);

/**
 * Recursively strip timestamp fields from an object for hash stability.
 */
function stripTimestamps(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripTimestamps);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (TIMESTAMP_KEYS.has(key)) continue;
    result[key] = stripTimestamps(value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hash a single pipeline component (snapshot, policy, stress, pricing, memo, or model).
 * Timestamps are stripped for stability.
 */
export function hashComponent(component: unknown): string {
  const stripped = stripTimestamps(component);
  // deterministicHash expects serializable input — coerce null/undefined to null
  return deterministicHash(stripped ?? null);
}

/**
 * Compute the overall artifact hash from all component hashes.
 * This is a hash-of-hashes — deterministic and order-independent.
 */
export function computeOverallHash(hashes: Omit<ArtifactHashes, "overallHash">): string {
  return deterministicHash({
    modelHash: hashes.modelHash,
    snapshotHash: hashes.snapshotHash,
    policyHash: hashes.policyHash,
    stressHash: hashes.stressHash,
    pricingHash: hashes.pricingHash,
    memoHash: hashes.memoHash,
  });
}

/**
 * Compute all artifact hashes from pipeline components.
 */
export function computeArtifactHashes(components: {
  model: unknown;
  snapshot: unknown;
  policy: unknown;
  stress: unknown;
  pricing: unknown;
  memo: unknown;
}): ArtifactHashes {
  const modelHash = hashComponent(components.model);
  const snapshotHash = hashComponent(components.snapshot);
  const policyHash = hashComponent(components.policy);
  const stressHash = hashComponent(components.stress);
  const pricingHash = hashComponent(components.pricing);
  const memoHash = hashComponent(components.memo);

  const overallHash = computeOverallHash({
    modelHash,
    snapshotHash,
    policyHash,
    stressHash,
    pricingHash,
    memoHash,
  });

  return {
    modelHash,
    snapshotHash,
    policyHash,
    stressHash,
    pricingHash,
    memoHash,
    overallHash,
  };
}
