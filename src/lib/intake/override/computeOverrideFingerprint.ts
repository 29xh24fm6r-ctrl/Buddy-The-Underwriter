/**
 * Override Fingerprint — Deterministic SHA-256 Identity for Override Clusters
 *
 * Encodes (fromType, toType, confidenceBucket, classifierSource, classificationVersion)
 * into a stable 64-char hex fingerprint. Used to deduplicate clusters across deployments.
 *
 * Version prefix "override_v1|" ensures fingerprints remain stable even if field
 * ordering or encoding changes in future versions.
 *
 * Pure function. No DB, no IO, no randomness, no timestamps.
 * Banned: Math.random, Date.now, crypto.randomUUID
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceBucket = "low" | "medium" | "high";

export type OverrideFingerprintInput = {
  fromType: string;
  toType: string;
  /** Derived from confidence_at_time — call bucketConfidence() */
  confidenceBucket: ConfidenceBucket;
  /** match_source from deal_documents — "Rules" | "DocAI" | "Gemini" | null */
  classifierSource: string | null;
  /** classification_version from deal_documents — null if not captured */
  classificationVersion: string | null;
};

// ---------------------------------------------------------------------------
// bucketConfidence — maps raw confidence to discrete bucket
// ---------------------------------------------------------------------------

/**
 * Buckets a raw confidence value into low / medium / high.
 *
 * Thresholds:
 *   low    = < 0.70
 *   medium = 0.70 – 0.89
 *   high   = ≥ 0.90
 */
export function bucketConfidence(confidence: number | null): ConfidenceBucket {
  if (confidence === null || confidence === undefined) return "low";
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// computeOverrideFingerprint — pure SHA-256 fingerprint
// ---------------------------------------------------------------------------

/**
 * Returns a full 64-char hex SHA-256 fingerprint encoding the override cluster identity.
 *
 * Canonical input string:
 *   "override_v1|{fromType}|{toType}|{confidenceBucket}|{classifierSource ?? 'unknown'}|{classificationVersion ?? 'unknown'}"
 */
export function computeOverrideFingerprint(input: OverrideFingerprintInput): string {
  const canonical = [
    "override_v1",
    input.fromType,
    input.toType,
    input.confidenceBucket,
    input.classifierSource ?? "unknown",
    input.classificationVersion ?? "unknown",
  ].join("|");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
