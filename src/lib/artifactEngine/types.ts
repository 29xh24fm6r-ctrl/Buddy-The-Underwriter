/**
 * Artifact Engine — Types
 *
 * Immutable underwrite artifact types for persistence and audit trail.
 *
 * PHASE 7: Persistence layer — no computation, no UI.
 */

// ---------------------------------------------------------------------------
// Artifact Hashes
// ---------------------------------------------------------------------------

export interface ArtifactHashes {
  modelHash: string;
  snapshotHash: string;
  policyHash: string;
  stressHash: string;
  pricingHash: string;
  memoHash: string;
  overallHash: string;
}

// ---------------------------------------------------------------------------
// Artifact Status
// ---------------------------------------------------------------------------

export type ArtifactStatus = "draft" | "finalized" | "superseded";

// ---------------------------------------------------------------------------
// Artifact Row (full DB row)
// ---------------------------------------------------------------------------

export interface ArtifactRow {
  id: string;
  dealId: string;
  bankId: string;
  productType: string;
  version: number;
  status: ArtifactStatus;
  supersedesArtifactId: string | null;

  snapshotJson: unknown;
  analysisJson: unknown;
  policyJson: unknown;
  stressJson: unknown;
  pricingJson: unknown;
  memoJson: unknown;

  hashes: ArtifactHashes;

  engineVersion: string;
  bankConfigVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Artifact Summary (list view — no JSONB payloads)
// ---------------------------------------------------------------------------

export interface ArtifactSummary {
  id: string;
  version: number;
  status: ArtifactStatus;
  productType: string;
  tier: string;
  recommendation: string;
  overallHash: string;
  createdBy: string | null;
  createdAt: string;
}
