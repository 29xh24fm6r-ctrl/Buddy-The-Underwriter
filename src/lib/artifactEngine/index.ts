/**
 * Artifact Engine — Public API
 *
 * Immutable, versioned, hash-verified underwrite artifact persistence.
 *
 * PHASE 7: Re-exports types, hashing, writer, and loader.
 */

export type {
  ArtifactRow,
  ArtifactSummary,
  ArtifactHashes,
  ArtifactStatus,
} from "./types";

export {
  hashComponent,
  computeOverallHash,
  computeArtifactHashes,
} from "./hash";

export { createUnderwriteArtifact } from "./writeArtifact";

export {
  loadLatestArtifact,
  loadArtifactById,
  loadArtifactHistory,
} from "./loadArtifact";
