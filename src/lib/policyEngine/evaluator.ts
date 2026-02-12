/**
 * Policy Engine — Evaluator
 *
 * Evaluates CreditSnapshot against product-specific policy thresholds.
 * Assigns risk tier based on breach count and severity.
 *
 * PHASE 5: Policy layer only — no pricing, no lifecycle mutation, no UI.
 *
 * Tier assignment:
 * - A: 0 breaches
 * - B: minor breaches only (no severe)
 * - C: 1 severe breach OR 3+ minor breaches
 * - D: 2+ severe breaches
 *
 * Breach severity:
 * - Minor: deviation within MINOR_BREACH_BAND (15%) of threshold
 * - Severe: deviation exceeds MINOR_BREACH_BAND
 *
 * Missing metrics → warnings (not failures). Only present-and-below metrics
 * count as threshold breaches.
 */

import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import type { ProductType } from "@/lib/creditLenses/types";
import type {
  BreachSeverity,
  PolicyResult,
  PolicyThreshold,
  RiskTier,
  ThresholdBreach,
} from "./types";
import { getPolicyDefinition, MINOR_BREACH_BAND } from "./policies";

// ---------------------------------------------------------------------------
// Metric value extraction
// ---------------------------------------------------------------------------

/** Map from policy metric keys to CreditSnapshot ratio keys */
const SNAPSHOT_METRIC_MAP: Record<string, string> = {
  dscr: "dscr",
  leverage: "leverageDebtToEbitda",
  currentRatio: "currentRatio",
  quickRatio: "quickRatio",
  workingCapital: "workingCapital",
  ebitdaMargin: "ebitdaMargin",
  netMargin: "netMargin",
};

function extractMetricValue(
  snapshot: CreditSnapshot,
  metricKey: string,
): number | undefined {
  const snapshotKey = SNAPSHOT_METRIC_MAP[metricKey] ?? metricKey;
  const metric = snapshot.ratios.metrics[snapshotKey as keyof typeof snapshot.ratios.metrics];
  return metric?.value;
}

// ---------------------------------------------------------------------------
// Breach computation
// ---------------------------------------------------------------------------

function computeDeviation(
  actual: number,
  threshold: PolicyThreshold,
): { breached: boolean; deviation: number } {
  if (threshold.minimum !== undefined && actual < threshold.minimum) {
    // Below minimum: deviation = how far below as fraction of threshold
    const deviation = (threshold.minimum - actual) / threshold.minimum;
    return { breached: true, deviation };
  }

  if (threshold.maximum !== undefined && actual > threshold.maximum) {
    // Above maximum: deviation = how far above as fraction of threshold
    const deviation = (actual - threshold.maximum) / threshold.maximum;
    return { breached: true, deviation };
  }

  return { breached: false, deviation: 0 };
}

function classifySeverity(deviation: number): BreachSeverity {
  return deviation <= MINOR_BREACH_BAND ? "minor" : "severe";
}

// ---------------------------------------------------------------------------
// Tier assignment
// ---------------------------------------------------------------------------

function assignTier(breaches: ThresholdBreach[]): RiskTier {
  if (breaches.length === 0) return "A";

  const severeCount = breaches.filter((b) => b.severity === "severe").length;
  const minorCount = breaches.filter((b) => b.severity === "minor").length;

  if (severeCount >= 2) return "D";
  if (severeCount >= 1 || minorCount >= 3) return "C";
  return "B";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a CreditSnapshot against product-specific policy thresholds.
 *
 * Rules:
 * - Only present metrics are evaluated against thresholds
 * - Missing metrics generate warnings, not failures
 * - Tier assigned based on breach count and severity
 *
 * Pure function — deterministic, no side effects.
 */
export function evaluatePolicy(
  snapshot: CreditSnapshot,
  product: ProductType,
): PolicyResult {
  const policy = getPolicyDefinition(product);
  const breaches: ThresholdBreach[] = [];
  const warnings: string[] = [];
  const metricsEvaluated: Record<string, number | undefined> = {};

  for (const threshold of policy.thresholds) {
    const value = extractMetricValue(snapshot, threshold.metric);
    metricsEvaluated[threshold.metric] = value;

    if (value === undefined) {
      warnings.push(`${threshold.metric} unavailable for policy evaluation`);
      continue;
    }

    const { breached, deviation } = computeDeviation(value, threshold);

    if (breached) {
      breaches.push({
        metric: threshold.metric,
        threshold,
        actualValue: value,
        severity: classifySeverity(deviation),
        deviation,
      });
    }
  }

  const failedMetrics = breaches.map((b) => b.metric);
  const tier = assignTier(breaches);

  return {
    product,
    passed: breaches.length === 0,
    failedMetrics,
    breaches,
    warnings,
    metricsEvaluated,
    tier,
  };
}
