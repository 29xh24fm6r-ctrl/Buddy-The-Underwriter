/**
 * Model Engine V2 — Risk Engine (Phase 1)
 *
 * Deterministic rule stubs — hardcoded thresholds, not bank-scoped.
 * No policy integration yet.
 */

import type { RiskFlag, RiskResult, RiskSeverity } from "./types";

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

interface RiskRule {
  key: string;
  metricKey: string;
  direction: "below" | "above";
  threshold: number;
  severity: RiskSeverity;
}

const RULES: RiskRule[] = [
  {
    key: "LOW_DSCR",
    metricKey: "DSCR",
    direction: "below",
    threshold: 1.15,
    severity: "HIGH",
  },
  {
    key: "HIGH_LEVERAGE",
    metricKey: "LEVERAGE",
    direction: "above",
    threshold: 4.5,
    severity: "MEDIUM",
  },
  {
    key: "LOW_CURRENT_RATIO",
    metricKey: "CURRENT_RATIO",
    direction: "below",
    threshold: 1.0,
    severity: "MEDIUM",
  },
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Run deterministic risk rules against computed metrics.
 *
 * @param metrics - Metric key → value map (from metric graph evaluation)
 * @returns RiskResult with flags for any breached thresholds
 */
export function evaluateRisk(
  metrics: Record<string, number | null>,
): RiskResult {
  const flags: RiskFlag[] = [];

  for (const rule of RULES) {
    const value = metrics[rule.metricKey];
    if (value === null || value === undefined) continue;

    let breached = false;
    if (rule.direction === "below" && value < rule.threshold) breached = true;
    if (rule.direction === "above" && value > rule.threshold) breached = true;

    if (breached) {
      flags.push({
        key: rule.key,
        value,
        threshold: rule.threshold,
        severity: rule.severity,
      });
    }
  }

  return { flags };
}
