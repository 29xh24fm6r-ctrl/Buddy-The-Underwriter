/**
 * E2 — Pure Preflight Blocker Computation
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Core Philosophy:
 *   Intake proves the world is correct.
 *   Spreads consume that proof.
 *   Spreads do NOT re-adjudicate intake.
 *
 * This module ONLY checks:
 *   1) Intake proof integrity (confirmed + snapshot hash match)
 *   2) Extraction completeness (heartbeats present)
 *   3) Extraction sanity (quality status not SUSPECT)
 *   4) Feature flag
 *
 * It NEVER checks:
 *   - Slot counts
 *   - Required doc presence
 *   - Intake blocker re-interpretation
 */

import { computeIntakeSnapshotHash } from "@/lib/intake/confirmation/types";
import type {
  PreflightInput,
  PreflightBlocker,
  PreflightBlockerCode,
} from "./types";

// ── Structural vs Execution Gate Contract (CI-locked) ─────────────────

/**
 * Hard blockers prevent spread orchestration.
 * These represent structural integrity violations — the deal state is
 * fundamentally wrong and no amount of waiting will fix it.
 *
 * Soft blockers (everything NOT in this set) are warnings.
 * They represent execution-layer conditions that the spread processor
 * handles internally (extraction, prereqs, retry).
 *
 * This constant is CI-locked. Do not add execution-layer conditions.
 */
export const HARD_BLOCKER_CODES = new Set<PreflightBlockerCode>([
  "INTAKE_NOT_CONFIRMED",
  "INTAKE_SNAPSHOT_HASH_MISMATCH",
  "SPREADS_DISABLED_BY_FLAG",
  "UNKNOWN_FAILSAFE",
]);

// ── Exported Constants (CI-locked) ────────────────────────────────────

/**
 * Canonical set of document types that require extraction (EXTRACTION_HEARTBEAT)
 * before spread rendering can proceed.
 */
export const EXTRACT_ELIGIBLE_TYPES = new Set([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "RENT_ROLL",
  "PERSONAL_FINANCIAL_STATEMENT",
  "PERSONAL_INCOME",
  "SCHEDULE_K1",
]);

/**
 * Intake phases where spread orchestration is allowed.
 * Spreads trust intake's confirmation gate — if the deal is in one
 * of these phases, the doc universe has been proved correct.
 */
export const CONFIRMED_PHASES = new Set([
  "CONFIRMED_READY_FOR_PROCESSING",
  "PROCESSING_COMPLETE",
  "PROCESSING_COMPLETE_WITH_ERRORS",
]);

// ── Pure Computation ──────────────────────────────────────────────────

/**
 * Compute preflight blockers for a deal's spread orchestration.
 *
 * Returns an array of blockers. Empty array = preflight passes.
 * Caller supplies all inputs — this function does NO DB access.
 */
export function computePreflightBlockers(
  input: PreflightInput,
): PreflightBlocker[] {
  const blockers: PreflightBlocker[] = [];

  // ── Failsafe: null/undefined guard ──────────────────────────────
  if (input.intakePhase == null || input.activeDocs == null) {
    blockers.push({
      code: "UNKNOWN_FAILSAFE",
      message:
        "Spread preflight received null state — cannot verify integrity",
    });
    return blockers; // short-circuit — nothing else is safe to check
  }

  // ── 1. Intake must be confirmed ─────────────────────────────────
  if (!CONFIRMED_PHASES.has(input.intakePhase)) {
    blockers.push({
      code: "INTAKE_NOT_CONFIRMED",
      message: `Deal is in phase "${input.intakePhase}" — intake must be confirmed before spreads can run`,
    });
  }

  // ── 2. Snapshot hash must match (exact same logic as intake) ────
  if (!input.storedSnapshotHash) {
    blockers.push({
      code: "INTAKE_SNAPSHOT_HASH_MISMATCH",
      message:
        "Intake snapshot hash missing — intake may not have completed confirmation",
    });
  } else if (input.activeDocs.length > 0) {
    const sealable = input.activeDocs.filter((d) => d.logical_key != null);
    const computed = computeIntakeSnapshotHash(
      sealable.map((d) => ({
        id: d.id,
        canonical_type: d.canonical_type,
        doc_year: d.doc_year,
      })),
    );
    if (computed !== input.storedSnapshotHash) {
      blockers.push({
        code: "INTAKE_SNAPSHOT_HASH_MISMATCH",
        message:
          "Document set has changed since confirmation — snapshot hash mismatch",
      });
    }
  }

  // ── 3. Extraction readiness (transient) ─────────────────────────
  const spreadEligible = input.activeDocs.filter(
    (d) => d.canonical_type != null && EXTRACT_ELIGIBLE_TYPES.has(d.canonical_type),
  );
  const notExtracted = spreadEligible.filter(
    (d) => !input.extractionHeartbeatDocIds.has(d.id),
  );
  if (notExtracted.length > 0) {
    blockers.push({
      code: "EXTRACTION_NOT_READY",
      message: `${notExtracted.length} document(s) awaiting extraction`,
      documentIds: notExtracted.map((d) => d.id),
      transient: true,
    });
  }

  // ── 4. Extraction quality (data integrity) ──────────────────────
  const suspects = input.activeDocs.filter(
    (d) =>
      d.extraction_quality_status === "SUSPECT" ||
      d.extraction_quality_status === "FAILED",
  );
  if (suspects.length > 0) {
    blockers.push({
      code: "EXTRACTION_SUSPECT",
      message: `${suspects.length} document(s) with suspect extraction results`,
      documentIds: suspects.map((d) => d.id),
      transient: false,
    });
  }

  // ── 5. Feature flag ─────────────────────────────────────────────
  if (!input.spreadsEnabled) {
    blockers.push({
      code: "SPREADS_DISABLED_BY_FLAG",
      message: "Spread computation is disabled by feature flag",
    });
  }

  return blockers;
}
