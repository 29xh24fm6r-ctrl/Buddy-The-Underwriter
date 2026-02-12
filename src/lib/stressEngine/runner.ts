/**
 * Stress Engine — Scenario Runner
 *
 * Runs a single stress scenario: applies transforms, computes snapshot,
 * evaluates policy, and calculates deltas against baseline.
 *
 * PHASE 5B: Pure computation — no DB, no side effects.
 */

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import type { CreditSnapshot, CreditSnapshotOpts } from "@/lib/creditMetrics/types";
import { computeCreditSnapshot } from "@/lib/creditMetrics";
import { evaluatePolicy } from "@/lib/policyEngine";
import type { ProductType } from "@/lib/creditLenses/types";
import type { StressScenarioDefinition, StressScenarioResult } from "./types";
import { applyEbitdaHaircut, applyRevenueHaircut, applyRateShock } from "./modelTransforms";

// ---------------------------------------------------------------------------
// Single scenario execution
// ---------------------------------------------------------------------------

/**
 * Run a single stress scenario against a financial model.
 *
 * Steps:
 * 1. Apply model transforms (EBITDA haircut, revenue haircut)
 * 2. Apply instrument transforms (rate shock)
 * 3. Compute credit snapshot from stressed inputs
 * 4. Evaluate policy against stressed snapshot
 * 5. Compute deltas against baseline (if provided)
 *
 * Returns undefined if snapshot computation fails (no suitable period).
 *
 * Pure function — deterministic, no side effects.
 */
export function runScenario(
  scenario: StressScenarioDefinition,
  model: FinancialModel,
  instruments: DebtInstrument[] | undefined,
  snapshotOpts: CreditSnapshotOpts,
  product: ProductType,
  baseline?: StressScenarioResult,
): StressScenarioResult | undefined {
  // Step 1: Apply model transforms
  let stressedModel = model;

  if (scenario.ebitdaHaircut !== undefined) {
    stressedModel = applyEbitdaHaircut(stressedModel, scenario.ebitdaHaircut);
  }

  if (scenario.revenueHaircut !== undefined) {
    stressedModel = applyRevenueHaircut(stressedModel, scenario.revenueHaircut);
  }

  // Step 2: Apply instrument transforms
  let stressedInstruments = instruments;

  if (scenario.rateShockBps !== undefined && instruments) {
    stressedInstruments = applyRateShock(instruments, scenario.rateShockBps);
  }

  // Step 3: Compute credit snapshot
  const opts: CreditSnapshotOpts = {
    ...snapshotOpts,
    instruments: stressedInstruments,
  };

  const snapshot = computeCreditSnapshot(stressedModel, opts);
  if (!snapshot) return undefined;

  // Step 4: Evaluate policy
  const policy = evaluatePolicy(snapshot, product);

  // Step 5: Compute deltas
  let dscrDelta: number | undefined;
  let debtServiceDelta: number | undefined;

  if (baseline) {
    const baselineDscr = baseline.snapshot.ratios.metrics.dscr?.value;
    const stressedDscr = snapshot.ratios.metrics.dscr?.value;

    if (baselineDscr !== undefined && stressedDscr !== undefined) {
      dscrDelta = stressedDscr - baselineDscr;
    }

    const baselineDS = baseline.snapshot.debtService.totalDebtService;
    const stressedDS = snapshot.debtService.totalDebtService;

    if (baselineDS !== undefined && stressedDS !== undefined) {
      debtServiceDelta = stressedDS - baselineDS;
    }
  }

  return {
    key: scenario.key,
    label: scenario.label,
    snapshot,
    policy,
    dscrDelta,
    debtServiceDelta,
  };
}
