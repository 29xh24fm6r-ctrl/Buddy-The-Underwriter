/**
 * Phase 13 — Registry Drift Detection
 *
 * Compares a deal's latest snapshot registry binding to the current live binding.
 * Pure function — no DB, no side effects.
 */

import type { ModelSnapshot } from "../types";
import type { RegistryBinding } from "@/lib/metrics/registry/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriftStatus {
  hasDrift: boolean;
  snapshotVersion: string | null;
  currentVersion: string | null;
  driftSeverity: "none" | "minor" | "major";
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect registry drift between a stored snapshot and the current live binding.
 *
 * Severity:
 * - none → versions match
 * - minor → versions differ (re-compute available)
 * - major → no snapshot / no binding / snapshot missing registry binding
 */
export function detectRegistryDrift(
  snapshot: ModelSnapshot | null,
  currentBinding: RegistryBinding | null,
): DriftStatus {
  // No snapshot at all → major
  if (!snapshot) {
    return {
      hasDrift: true,
      snapshotVersion: null,
      currentVersion: currentBinding?.registryVersionName ?? null,
      driftSeverity: "major",
      reason: "no_snapshot",
    };
  }

  // No current binding → major
  if (!currentBinding) {
    return {
      hasDrift: true,
      snapshotVersion: snapshot.registryVersionName ?? null,
      currentVersion: null,
      driftSeverity: "major",
      reason: "no_current_binding",
    };
  }

  // Snapshot missing registry binding → major
  if (!snapshot.registryVersionName) {
    return {
      hasDrift: true,
      snapshotVersion: null,
      currentVersion: currentBinding.registryVersionName,
      driftSeverity: "major",
      reason: "snapshot_missing_registry_version",
    };
  }

  // Versions match → no drift
  if (snapshot.registryVersionName === currentBinding.registryVersionName) {
    return {
      hasDrift: false,
      snapshotVersion: snapshot.registryVersionName,
      currentVersion: currentBinding.registryVersionName,
      driftSeverity: "none",
      reason: null,
    };
  }

  // Versions differ → minor drift
  return {
    hasDrift: true,
    snapshotVersion: snapshot.registryVersionName,
    currentVersion: currentBinding.registryVersionName,
    driftSeverity: "minor",
    reason: "version_mismatch",
  };
}
