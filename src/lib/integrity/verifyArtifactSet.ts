/**
 * Artifact Set Verification (Phase L — cc Spec).
 *
 * Verifies the integrity of a complete set of audit artifacts:
 *   - Individual artifact hash recomputation (SHA-256)
 *   - Aggregate drop hash verification
 *   - Manifest completeness check
 *   - Cross-artifact consistency validation
 *
 * Works with examiner drop manifests from buildExaminerDropZip.
 * Strictly read-only — mismatches are reported, never corrected.
 *
 * Invariants:
 *   - Deterministic: same inputs → same result
 *   - No mutations
 *   - All checks return structured results with timestamps
 *   - Partial failures don't abort — every artifact is checked
 */

import { sha256 } from "@/lib/security/tokens";
import { stableStringify } from "@/lib/audit/buildBorrowerAuditSnapshot";
import type {
  IntegrityCheckResult,
  ManifestVerificationResult,
} from "./verifySnapshot";

// ── Types ───────────────────────────────────────────────

export type ArtifactEntry = {
  path: string;
  sha256: string;
  size_bytes: number;
  content_type?: string;
};

export type ArtifactSetInput = {
  /** The manifest describing expected artifacts and hashes. */
  manifest: {
    drop_version?: string;
    generated_at?: string;
    deal_id?: string;
    bank_id?: string;
    artifacts: ArtifactEntry[];
    drop_hash: string;
    borrower_audit_hash?: string | null;
    credit_decision_hash?: string | null;
  };

  /**
   * Map of artifact path → raw content string.
   * For JSON artifacts, provide the JSON string.
   * For binary artifacts (PDF), provide the base64 string.
   */
  contents: Map<string, string>;

  /**
   * Optional: structured snapshots for deeper verification.
   * When provided, the module verifies that stableStringify(snapshot) + SHA-256
   * matches the manifest hash for the corresponding path.
   */
  snapshots?: Map<string, unknown>;
};

export type ArtifactSetVerification = {
  check_version: "1.0";
  checked_at: string;

  /** Overall pass/fail. */
  valid: boolean;

  /** Summary counts. */
  total_artifacts: number;
  verified: number;
  mismatched: number;
  missing: number;

  /** Drop-level hash check. */
  drop_hash_match: boolean;
  expected_drop_hash: string;
  computed_drop_hash: string;

  /** Per-artifact results. */
  results: IntegrityCheckResult[];

  /** Cross-artifact consistency checks. */
  consistency: ConsistencyCheck[];
};

export type ConsistencyCheck = {
  check: string;
  passed: boolean;
  detail: string;
};

// ── Main Verification Function ──────────────────────────

/**
 * Verify an entire artifact set against its manifest.
 *
 * Checks:
 *   1. Each artifact's content hash matches the manifest hash.
 *   2. The aggregate drop hash matches.
 *   3. All manifest entries have corresponding content.
 *   4. Cross-artifact consistency (e.g., borrower/decision hashes).
 */
export function verifyArtifactSet(input: ArtifactSetInput): ArtifactSetVerification {
  const checkedAt = new Date().toISOString();
  const results: IntegrityCheckResult[] = [];
  const consistency: ConsistencyCheck[] = [];

  let verified = 0;
  let mismatched = 0;
  let missing = 0;

  // ── 1. Per-artifact hash verification ─────────────────

  for (const artifact of input.manifest.artifacts) {
    // Try structured snapshot first (highest fidelity)
    const snapshot = input.snapshots?.get(artifact.path);
    const rawContent = input.contents.get(artifact.path);

    if (snapshot !== undefined) {
      // Recompute from canonical JSON
      const canonical = stableStringify(snapshot);
      const computedHash = sha256(canonical);
      const match = computedHash === artifact.sha256;

      results.push({
        check_version: "1.0",
        checked_at: checkedAt,
        artifact_type: "snapshot",
        artifact_id: artifact.path,
        expected_hash: artifact.sha256,
        computed_hash: computedHash,
        match,
        details: match
          ? `"${artifact.path}" verified from structured snapshot.`
          : `"${artifact.path}" hash mismatch (snapshot recomputation).`,
      });

      if (match) verified++;
      else mismatched++;
    } else if (rawContent !== undefined) {
      // Verify from raw content string
      const computedHash = sha256(rawContent);
      const match = computedHash === artifact.sha256;

      results.push({
        check_version: "1.0",
        checked_at: checkedAt,
        artifact_type: artifact.content_type ?? "file",
        artifact_id: artifact.path,
        expected_hash: artifact.sha256,
        computed_hash: computedHash,
        match,
        details: match
          ? `"${artifact.path}" integrity verified.`
          : `"${artifact.path}" hash mismatch.`,
      });

      if (match) verified++;
      else mismatched++;
    } else {
      // Missing content — can't verify
      results.push({
        check_version: "1.0",
        checked_at: checkedAt,
        artifact_type: artifact.content_type ?? "file",
        artifact_id: artifact.path,
        expected_hash: artifact.sha256,
        computed_hash: "",
        match: false,
        details: `"${artifact.path}" not provided for verification.`,
      });
      missing++;
    }
  }

  // ── 2. Aggregate drop hash verification ───────────────

  const allArtifactHashes = input.manifest.artifacts.map((a) => a.sha256).join("|");
  const computedDropHash = sha256(allArtifactHashes);
  const dropHashMatch = computedDropHash === input.manifest.drop_hash;

  // ── 3. Cross-artifact consistency checks ──────────────

  // Check: manifest has artifacts
  consistency.push({
    check: "manifest_has_artifacts",
    passed: input.manifest.artifacts.length > 0,
    detail: input.manifest.artifacts.length > 0
      ? `Manifest declares ${input.manifest.artifacts.length} artifact(s).`
      : "Manifest has no artifacts.",
  });

  // Check: all content provided
  const allProvided = missing === 0;
  consistency.push({
    check: "all_content_provided",
    passed: allProvided,
    detail: allProvided
      ? "All artifact contents provided for verification."
      : `${missing} artifact(s) missing content.`,
  });

  // Check: borrower audit hash cross-reference
  if (input.manifest.borrower_audit_hash) {
    const borrowerArtifact = input.manifest.artifacts.find(
      (a) => a.path === "borrower-audit/snapshot.json",
    );
    if (borrowerArtifact) {
      const borrowerContent = input.contents.get("borrower-audit/snapshot.json");
      if (borrowerContent) {
        const borrowerSnap = safeParse(borrowerContent);
        if (borrowerSnap && typeof borrowerSnap === "object" && "snapshot_hash" in (borrowerSnap as Record<string, unknown>)) {
          const snapHash = (borrowerSnap as Record<string, unknown>).snapshot_hash;
          const crossMatch = snapHash === input.manifest.borrower_audit_hash;
          consistency.push({
            check: "borrower_audit_hash_crossref",
            passed: crossMatch,
            detail: crossMatch
              ? "Borrower audit hash in manifest matches snapshot's internal hash."
              : "Borrower audit hash mismatch between manifest and snapshot internal hash.",
          });
        }
      }
    }
  }

  // Check: credit decision hash cross-reference
  if (input.manifest.credit_decision_hash) {
    const decisionArtifact = input.manifest.artifacts.find(
      (a) => a.path === "credit-decision/snapshot.json",
    );
    if (decisionArtifact) {
      const decisionContent = input.contents.get("credit-decision/snapshot.json");
      if (decisionContent) {
        const decisionSnap = safeParse(decisionContent);
        if (decisionSnap && typeof decisionSnap === "object" && "snapshot_hash" in (decisionSnap as Record<string, unknown>)) {
          const snapHash = (decisionSnap as Record<string, unknown>).snapshot_hash;
          const crossMatch = snapHash === input.manifest.credit_decision_hash;
          consistency.push({
            check: "credit_decision_hash_crossref",
            passed: crossMatch,
            detail: crossMatch
              ? "Credit decision hash in manifest matches snapshot's internal hash."
              : "Credit decision hash mismatch between manifest and snapshot internal hash.",
          });
        }
      }
    }
  }

  // Check: no duplicate paths
  const paths = input.manifest.artifacts.map((a) => a.path);
  const uniquePaths = new Set(paths);
  consistency.push({
    check: "no_duplicate_paths",
    passed: uniquePaths.size === paths.length,
    detail: uniquePaths.size === paths.length
      ? "All artifact paths are unique."
      : `${paths.length - uniquePaths.size} duplicate path(s) found.`,
  });

  // ── Assemble result ───────────────────────────────────

  const valid =
    mismatched === 0 &&
    missing === 0 &&
    dropHashMatch &&
    consistency.every((c) => c.passed);

  return {
    check_version: "1.0",
    checked_at: checkedAt,
    valid,
    total_artifacts: input.manifest.artifacts.length,
    verified,
    mismatched,
    missing,
    drop_hash_match: dropHashMatch,
    expected_drop_hash: input.manifest.drop_hash,
    computed_drop_hash: computedDropHash,
    results,
    consistency,
  };
}

// ── Helpers ─────────────────────────────────────────────

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
