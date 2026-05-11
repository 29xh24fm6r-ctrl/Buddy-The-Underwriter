/**
 * SPEC-12.1 — Deterministic committee risk scoring.
 *
 * Pure function. No side effects, no fetch, no Date.now().
 * Returns { total, factors } — NEVER returns severity.
 * Severity is decided externally by mapScoreToSeverity().
 *
 * Non-negotiable #1: committee-agnostic, pure, generic factor inputs.
 * Non-negotiable #2: returns { total, factors }, never severity.
 */

export interface RiskScoreInput {
  overrides: Array<{ severity?: string | null; requires_review?: boolean }>;
  memoGaps: number;
  blockers: Array<unknown>;
  readinessPct: number;
}

export interface RiskScoreFactor {
  count: number;
  points: number;
}

export interface RiskScoreReadinessFactor {
  pct: number;
  points: number;
}

export interface RiskScore {
  total: number;
  factors: {
    criticalOverrides: RiskScoreFactor;
    warningOverrides: RiskScoreFactor;
    memoGaps: RiskScoreFactor;
    blockers: RiskScoreFactor;
    readinessPenalty: RiskScoreReadinessFactor;
  };
}

const CRITICAL_OVERRIDE_POINTS = 30;
const WARNING_OVERRIDE_POINTS = 15;
const MEMO_GAP_POINTS = 10;
const BLOCKER_POINTS = 25;
const READINESS_BELOW_60_POINTS = 30;
const READINESS_BELOW_80_POINTS = 15;

export function buildRiskScore(input: RiskScoreInput): RiskScore {
  const criticalOverrideCount = input.overrides.filter(
    (o) =>
      (o.severity ?? "").toUpperCase() === "CRITICAL" ||
      (o.severity ?? "").toUpperCase() === "HIGH",
  ).length;

  const warningOverrideCount = input.overrides.filter(
    (o) =>
      o.requires_review === true &&
      (o.severity ?? "").toUpperCase() === "WARNING",
  ).length;

  const blockerCount = input.blockers.length;
  const memoGapCount = input.memoGaps;
  const readinessPct = input.readinessPct;

  const readinessPoints =
    readinessPct < 60
      ? READINESS_BELOW_60_POINTS
      : readinessPct < 80
        ? READINESS_BELOW_80_POINTS
        : 0;

  const factors = {
    criticalOverrides: {
      count: criticalOverrideCount,
      points: criticalOverrideCount * CRITICAL_OVERRIDE_POINTS,
    },
    warningOverrides: {
      count: warningOverrideCount,
      points: warningOverrideCount * WARNING_OVERRIDE_POINTS,
    },
    memoGaps: {
      count: memoGapCount,
      points: memoGapCount * MEMO_GAP_POINTS,
    },
    blockers: {
      count: blockerCount,
      points: blockerCount * BLOCKER_POINTS,
    },
    readinessPenalty: {
      pct: readinessPct,
      points: readinessPoints,
    },
  };

  const total =
    factors.criticalOverrides.points +
    factors.warningOverrides.points +
    factors.memoGaps.points +
    factors.blockers.points +
    factors.readinessPenalty.points;

  return { total, factors };
}

// ── Severity mapping (external to score) ───────────────────────────────────

export type RiskSeverityThresholds = {
  critical: number;
  warning: number;
};

export type RiskSeverityLabel = "critical" | "warning" | "below_threshold";

export function mapScoreToSeverity(
  score: number,
  thresholds: RiskSeverityThresholds,
): RiskSeverityLabel {
  if (score >= thresholds.critical) return "critical";
  if (score >= thresholds.warning) return "warning";
  return "below_threshold";
}

export const COMMITTEE_RISK_THRESHOLDS: RiskSeverityThresholds = {
  critical: 70,
  warning: 40,
};
