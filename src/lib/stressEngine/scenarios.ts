/**
 * Stress Engine — Scenario Definitions
 *
 * Five institutional stress scenarios: BASELINE + 4 stress cases.
 * All parameters are constants — no runtime configuration.
 *
 * PHASE 5B: Pure constants — no logic, no DB.
 */

import type { StressScenarioDefinition, StressScenarioKey } from "./types";

// ---------------------------------------------------------------------------
// Scenario Definitions
// ---------------------------------------------------------------------------

const BASELINE: StressScenarioDefinition = {
  key: "BASELINE",
  label: "Baseline (No Stress)",
};

const EBITDA_10_DOWN: StressScenarioDefinition = {
  key: "EBITDA_10_DOWN",
  label: "EBITDA -10%",
  ebitdaHaircut: 0.10,
};

const REVENUE_10_DOWN: StressScenarioDefinition = {
  key: "REVENUE_10_DOWN",
  label: "Revenue -10%",
  revenueHaircut: 0.10,
};

const RATE_PLUS_200: StressScenarioDefinition = {
  key: "RATE_PLUS_200",
  label: "Rate +200bps",
  rateShockBps: 200,
};

const COMBINED_MODERATE: StressScenarioDefinition = {
  key: "COMBINED_MODERATE",
  label: "EBITDA -10% + Rate +200bps",
  ebitdaHaircut: 0.10,
  rateShockBps: 200,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STRESS_SCENARIOS: readonly StressScenarioDefinition[] = [
  BASELINE,
  EBITDA_10_DOWN,
  REVENUE_10_DOWN,
  RATE_PLUS_200,
  COMBINED_MODERATE,
] as const;

export function getScenarioDefinition(
  key: StressScenarioKey,
): StressScenarioDefinition {
  const found = STRESS_SCENARIOS.find((s) => s.key === key);
  if (!found) throw new Error(`Unknown stress scenario: ${key}`);
  return found;
}
