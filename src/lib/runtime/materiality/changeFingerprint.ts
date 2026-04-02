/**
 * Change Fingerprint — Phase 66B Material Change Engine
 *
 * Pure function module. Generates deterministic fingerprints for deal state
 * to detect changes between computation cycles.
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DealStateSnapshot {
  loanAmount: number;
  entityName: string;
  naicsCode: string;
  documentIds: string[];
  factKeys: string[];
  snapshotHash: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Normalize a deal state snapshot into a stable, JSON-serializable form.
 * Sorting arrays ensures the fingerprint is deterministic regardless of
 * insertion order.
 */
function normalizeDealState(state: DealStateSnapshot): string {
  const normalized = {
    loanAmount: state.loanAmount,
    entityName: state.entityName.trim().toLowerCase(),
    naicsCode: state.naicsCode.trim(),
    documentIds: [...state.documentIds].sort(),
    factKeys: [...state.factKeys].sort(),
    snapshotHash: state.snapshotHash,
  };
  return JSON.stringify(normalized);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 fingerprint for an entire deal state snapshot.
 */
export function computeDealFingerprint(dealState: DealStateSnapshot): string {
  return sha256(normalizeDealState(dealState));
}

/**
 * Compute a SHA-256 fingerprint for a single section of deal data.
 */
export function computeSectionFingerprint(
  section: string,
  data: Record<string, unknown>,
): string {
  const payload = JSON.stringify({ section, data });
  return sha256(payload);
}

/**
 * Compare two fingerprints and report whether they differ.
 */
export function diffFingerprints(
  oldFp: string,
  newFp: string,
): { changed: boolean } {
  return { changed: oldFp !== newFp };
}
