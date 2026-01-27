/**
 * Inline Integrity Verification (Phase L)
 *
 * Allows examiners to recompute hashes and verify snapshot integrity.
 * Works both server-side and provides data for client-side verification.
 *
 * Invariants:
 *  - Hash computation is deterministic (stableStringify + SHA-256)
 *  - Verification results include full audit trail
 *  - No mutations — strictly read-only
 *  - Mismatches are reported, never auto-corrected
 */

import { sha256 } from "@/lib/security/tokens";
import { stableStringify } from "@/lib/audit/buildBorrowerAuditSnapshot";

// ── Types ──────────────────────────────────────────────

export type IntegrityCheckResult = {
  check_version: "1.0";
  checked_at: string;
  artifact_type: string;
  artifact_id: string;
  expected_hash: string;
  computed_hash: string;
  match: boolean;
  details: string;
};

export type ManifestVerificationResult = {
  check_version: "1.0";
  checked_at: string;
  manifest_valid: boolean;
  artifacts_checked: number;
  artifacts_matched: number;
  artifacts_mismatched: number;
  drop_hash_match: boolean;
  results: IntegrityCheckResult[];
};

// ── Verification Functions ─────────────────────────────

/**
 * Verify a single snapshot hash by recomputing from its canonical JSON.
 */
export function verifySnapshotHash(args: {
  snapshot: unknown;
  expectedHash: string;
  artifactType: string;
  artifactId: string;
}): IntegrityCheckResult {
  const checkedAt = new Date().toISOString();
  const canonicalJson = stableStringify(args.snapshot);
  const computedHash = sha256(canonicalJson);
  const match = computedHash === args.expectedHash;

  return {
    check_version: "1.0",
    checked_at: checkedAt,
    artifact_type: args.artifactType,
    artifact_id: args.artifactId,
    expected_hash: args.expectedHash,
    computed_hash: computedHash,
    match,
    details: match
      ? "Hash verified. Artifact is unchanged since generation."
      : "Hash mismatch. Artifact may have been modified since generation.",
  };
}

/**
 * Verify an entire examiner drop manifest.
 * Recomputes the aggregate drop hash from individual artifact hashes.
 */
export function verifyDropManifest(args: {
  manifest: {
    drop_hash: string;
    artifacts: Array<{
      path: string;
      sha256: string;
      size_bytes: number;
    }>;
  };
  artifactContents: Map<string, string>;
}): ManifestVerificationResult {
  const checkedAt = new Date().toISOString();
  const results: IntegrityCheckResult[] = [];
  let matched = 0;
  let mismatched = 0;

  for (const artifact of args.manifest.artifacts) {
    const content = args.artifactContents.get(artifact.path);

    if (content === undefined) {
      results.push({
        check_version: "1.0",
        checked_at: checkedAt,
        artifact_type: "file",
        artifact_id: artifact.path,
        expected_hash: artifact.sha256,
        computed_hash: "",
        match: false,
        details: `Artifact "${artifact.path}" not provided for verification.`,
      });
      mismatched++;
      continue;
    }

    const computedHash = sha256(content);
    const match = computedHash === artifact.sha256;

    results.push({
      check_version: "1.0",
      checked_at: checkedAt,
      artifact_type: "file",
      artifact_id: artifact.path,
      expected_hash: artifact.sha256,
      computed_hash: computedHash,
      match,
      details: match
        ? `"${artifact.path}" integrity verified.`
        : `"${artifact.path}" hash mismatch.`,
    });

    if (match) matched++;
    else mismatched++;
  }

  // Verify aggregate drop hash
  const allArtifactHashes = args.manifest.artifacts.map((a) => a.sha256).join("|");
  const computedDropHash = sha256(allArtifactHashes);
  const dropHashMatch = computedDropHash === args.manifest.drop_hash;

  return {
    check_version: "1.0",
    checked_at: checkedAt,
    manifest_valid: mismatched === 0 && dropHashMatch,
    artifacts_checked: args.manifest.artifacts.length,
    artifacts_matched: matched,
    artifacts_mismatched: mismatched,
    drop_hash_match: dropHashMatch,
    results,
  };
}

/**
 * Compute the hash of a snapshot for display/comparison.
 * Used by examiners for inline verification.
 */
export function computeSnapshotHash(snapshot: unknown): string {
  const canonicalJson = stableStringify(snapshot);
  return sha256(canonicalJson);
}

/**
 * Compute a drop hash from a list of artifact hashes.
 * Used by examiners to independently verify the aggregate.
 */
export function computeDropHash(artifactHashes: string[]): string {
  return sha256(artifactHashes.join("|"));
}
