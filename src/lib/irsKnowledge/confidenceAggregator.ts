/**
 * Proof-of-Correctness — Confidence Aggregator
 *
 * Computes a composite confidence score from field-level extraction confidence,
 * identity check results, corroboration results, and reasonableness results.
 * Pure function — no DB calls.
 */

export type ConfidenceStatus = "AUTO_VERIFIED" | "FLAGGED" | "BLOCKED";

export type ConfidenceBreakdown = {
  fieldAvg: number;
  identityMultiplier: number;
  corroborationMultiplier: number;
  reasonablenessMultiplier: number;
};

export type ConfidenceResult = {
  score: number;
  status: ConfidenceStatus;
  breakdown: ConfidenceBreakdown;
};

export type AggregateConfidenceParams = {
  fieldConfidenceScores: Record<string, number>;
  identityCheckResult: {
    passedCount: number;
    failedCount: number;
    skippedCount: number;
  };
  corroborationResult: {
    passedCount: number;
    failedCount: number;
    skippedCount: number;
  };
  reasonablenessResult: {
    impossibleFailures: number;
    anomalousWarnings: number;
  };
};

/**
 * Aggregate per-gate results into a composite confidence score.
 *
 * Score = fieldAvg × identityMultiplier × corroborationMultiplier × reasonablenessMultiplier
 *
 * Thresholds:
 *   AUTO_VERIFIED: score >= 0.92
 *   FLAGGED:       score >= 0.75
 *   BLOCKED:       score < 0.75
 */
export function aggregateDocumentConfidence(
  params: AggregateConfidenceParams,
): ConfidenceResult {
  const { fieldConfidenceScores, identityCheckResult, corroborationResult, reasonablenessResult } = params;

  // Field average — default 0.85 if empty
  const fieldValues = Object.values(fieldConfidenceScores);
  const fieldAvg =
    fieldValues.length > 0
      ? fieldValues.reduce((sum, v) => sum + v, 0) / fieldValues.length
      : 0.85;

  // Identity multiplier
  const identityMultiplier = identityCheckResult.failedCount > 0 ? 0.7 : 1.0;

  // Corroboration multiplier
  let corroborationMultiplier = 1.0;
  if (corroborationResult.failedCount > 0) {
    corroborationMultiplier = corroborationResult.passedCount === 0 ? 0.5 : 0.8;
  }

  // Reasonableness multiplier
  let reasonablenessMultiplier = 1.0;
  if (reasonablenessResult.impossibleFailures > 0) {
    reasonablenessMultiplier = 0.5;
  } else if (reasonablenessResult.anomalousWarnings > 0) {
    reasonablenessMultiplier = 0.9;
  }

  const score = fieldAvg * identityMultiplier * corroborationMultiplier * reasonablenessMultiplier;

  let status: ConfidenceStatus;
  if (score >= 0.92) {
    status = "AUTO_VERIFIED";
  } else if (score >= 0.75) {
    status = "FLAGGED";
  } else {
    status = "BLOCKED";
  }

  return {
    score,
    status,
    breakdown: {
      fieldAvg,
      identityMultiplier,
      corroborationMultiplier,
      reasonablenessMultiplier,
    },
  };
}
