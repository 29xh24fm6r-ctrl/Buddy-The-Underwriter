/**
 * Phase 55A — Snapshot Completeness / Conflict / Freshness Engine
 *
 * Determines whether a snapshot is usable for memo/decision purposes.
 * Pure function — no DB calls.
 */

import type { FinancialSnapshotStatus, SnapshotCompletenessReport } from "./types";
import type { FinancialSnapshotFact } from "./financial-fact-types";

type ReadinessInput = {
  snapshotStatus: FinancialSnapshotStatus;
  facts: FinancialSnapshotFact[];
  requiredMetricKeys: string[];
  snapshotAge?: number; // days since creation
  maxStalenessDays?: number; // default 30
};

const DEFAULT_MAX_STALENESS_DAYS = 30;

/**
 * Evaluate whether a snapshot is ready for downstream use.
 */
export function evaluateSnapshotReadiness(input: ReadinessInput): SnapshotCompletenessReport {
  const { snapshotStatus, facts, requiredMetricKeys, snapshotAge = 0, maxStalenessDays = DEFAULT_MAX_STALENESS_DAYS } = input;

  if (snapshotStatus === "not_started" || snapshotStatus === "collecting_inputs") {
    return {
      snapshotStatus,
      completenessPercent: 0,
      criticalMissingFacts: requiredMetricKeys,
      unresolvedConflicts: [],
      staleReasons: [],
      reviewRequired: false,
      decisionSafe: false,
      memoSafe: false,
      nextRecommendedAction: "Upload financial documents to begin snapshot generation",
    };
  }

  // Critical missing facts
  const presentKeys = new Set(
    facts.filter((f) => f.validationState !== "missing" && f.validationState !== "rejected")
      .map((f) => f.metricKey),
  );
  const criticalMissing = requiredMetricKeys.filter((k) => !presentKeys.has(k));

  // Unresolved conflicts
  const conflicts = facts
    .filter((f) => f.validationState === "conflicted")
    .map((f) => ({
      metricKey: f.metricKey,
      period: f.periodKey,
      conflictSources: f.conflictState ? parseInt(f.conflictState) || 2 : 2,
    }));

  // Staleness
  const staleReasons: string[] = [];
  if (snapshotStatus === "stale") staleReasons.push("Snapshot marked stale by newer evidence");
  if (snapshotAge > maxStalenessDays) staleReasons.push(`Snapshot is ${snapshotAge} days old (max ${maxStalenessDays})`);

  // Completeness
  const totalRequired = requiredMetricKeys.length;
  const presentRequired = totalRequired - criticalMissing.length;
  const completenessPercent = totalRequired > 0
    ? Math.round((presentRequired / totalRequired) * 100)
    : (facts.length > 0 ? 100 : 0);

  // Review required?
  const reviewRequired = conflicts.length > 0
    || criticalMissing.length > 0
    || facts.some((f) => f.validationState === "needs_review");

  // Decision / memo safety
  const decisionSafe = snapshotStatus === "validated"
    && conflicts.length === 0
    && criticalMissing.length === 0
    && staleReasons.length === 0;

  const memoSafe = (snapshotStatus === "validated" || snapshotStatus === "partially_validated")
    && criticalMissing.length === 0
    && staleReasons.length === 0;

  // Next action
  let nextRecommendedAction: string | null = null;
  if (criticalMissing.length > 0) {
    nextRecommendedAction = `Upload documents for missing metrics: ${criticalMissing.slice(0, 3).join(", ")}`;
  } else if (conflicts.length > 0) {
    nextRecommendedAction = `Resolve ${conflicts.length} conflicting financial fact(s)`;
  } else if (staleReasons.length > 0) {
    nextRecommendedAction = "Rebuild snapshot with latest financial evidence";
  } else if (reviewRequired) {
    nextRecommendedAction = "Review flagged financial facts in validation workbench";
  }

  return {
    snapshotStatus,
    completenessPercent,
    criticalMissingFacts: criticalMissing,
    unresolvedConflicts: conflicts,
    staleReasons,
    reviewRequired,
    decisionSafe,
    memoSafe,
    nextRecommendedAction,
  };
}
