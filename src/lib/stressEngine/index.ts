/**
 * Stress Engine — Public API
 *
 * Runs all stress scenarios against a financial model and aggregates results.
 *
 * PHASE 5B: Pure computation — no DB, no pricing, no UI.
 */

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import type { CreditSnapshotOpts } from "@/lib/creditMetrics/types";
import type { ProductType } from "@/lib/creditLenses/types";
import type { RiskTier } from "@/lib/policyEngine/types";
import type { StressResult, StressScenarioDefinition, StressScenarioResult } from "./types";
import { STRESS_SCENARIOS } from "./scenarios";
import { runScenario } from "./runner";

// Re-export types
export type {
  StressScenarioKey,
  StressScenarioDefinition,
  StressScenarioResult,
  StressResult,
} from "./types";

// Re-export sub-modules
export { STRESS_SCENARIOS, getScenarioDefinition } from "./scenarios";
export { applyEbitdaHaircut, applyRevenueHaircut, applyRateShock } from "./modelTransforms";
export { runScenario } from "./runner";

// ---------------------------------------------------------------------------
// Tier comparison
// ---------------------------------------------------------------------------

const TIER_ORDER: Record<RiskTier, number> = { A: 0, B: 1, C: 2, D: 3 };

/** Compare two risk tiers. Returns positive if a is worse than b. */
export function compareTiers(a: RiskTier, b: RiskTier): number {
  return TIER_ORDER[a] - TIER_ORDER[b];
}

function worstOf(a: RiskTier, b: RiskTier): RiskTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StressOpts {
  product: ProductType;
  /** Custom stress scenarios. If provided, replaces system defaults entirely. */
  scenarios?: StressScenarioDefinition[];
}

/**
 * Run all institutional stress scenarios against a financial model.
 *
 * Pipeline:
 * 1. Run BASELINE scenario (no transforms) to establish reference
 * 2. Run each stress scenario with appropriate transforms
 * 3. Compute aggregate: worstTier, tierDegraded
 *
 * Returns undefined if baseline snapshot fails (no suitable period).
 *
 * Pure function — deterministic, no side effects.
 */
export function runStressScenarios(
  model: FinancialModel,
  instruments: DebtInstrument[] | undefined,
  snapshotOpts: CreditSnapshotOpts,
  opts: StressOpts,
): StressResult | undefined {
  const scenarioDefs = opts.scenarios ?? STRESS_SCENARIOS;
  const baselineScenario = scenarioDefs[0]; // Always BASELINE first

  // Run baseline
  const baseline = runScenario(
    baselineScenario,
    model,
    instruments,
    snapshotOpts,
    opts.product,
  );

  if (!baseline) return undefined;

  // Run stress scenarios
  const scenarios: StressScenarioResult[] = [baseline];

  for (let i = 1; i < scenarioDefs.length; i++) {
    const result = runScenario(
      scenarioDefs[i],
      model,
      instruments,
      snapshotOpts,
      opts.product,
      baseline,
    );

    if (result) {
      scenarios.push(result);
    }
  }

  // Aggregate
  let worst: RiskTier = baseline.policy.tier;
  let tierDegraded = false;

  for (const s of scenarios) {
    worst = worstOf(worst, s.policy.tier);
    if (compareTiers(s.policy.tier, baseline.policy.tier) > 0) {
      tierDegraded = true;
    }
  }

  return {
    baseline,
    scenarios,
    worstTier: worst,
    tierDegraded,
  };
}
