/**
 * Pricing Engine — Public API
 *
 * Computes risk-based pricing: base rate + tier premium + stress adjustment.
 *
 * PHASE 5C: Pure computation — no DB, no live rates, no UI.
 */

import type { PricingOpts, PricingResult } from "./types";
import { getBaseRate } from "./rateTable";
import { getRiskPremiumBps } from "./riskPremium";
import { getStressAdjustmentBps } from "./stressAdjust";

// Re-export types
export type {
  PricingResult,
  PricingOpts,
  BaseRateEntry,
  RateIndex,
} from "./types";

// Re-export sub-modules
export { getBaseRate, INDEX_RATES } from "./rateTable";
export { getRiskPremiumBps } from "./riskPremium";
export { getStressAdjustmentBps } from "./stressAdjust";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute risk-based pricing for a product/tier combination.
 *
 * Formula:
 *   finalRate = baseRate + (riskPremiumBps + stressAdjustmentBps) / 10000
 *
 * Pure function — deterministic, no side effects.
 */
export function computePricing(opts: PricingOpts): PricingResult {
  const { product, tier, stressedTier } = opts;

  const baseEntry = getBaseRate(product);
  const riskPremiumBps = getRiskPremiumBps(tier);
  const stressAdjustmentBps = getStressAdjustmentBps(tier, stressedTier);

  const totalAdjustmentBps = riskPremiumBps + stressAdjustmentBps;
  const finalRate = baseEntry.baseRate + totalAdjustmentBps / 10_000;

  // Build rationale
  const rationale: string[] = [];

  rationale.push(
    `Base rate: ${baseEntry.index} ${(baseEntry.indexRate * 100).toFixed(2)}% + ${baseEntry.spreadBps}bps spread = ${(baseEntry.baseRate * 100).toFixed(2)}%`,
  );

  rationale.push(
    `Risk premium: Tier ${tier} → +${riskPremiumBps}bps`,
  );

  if (stressAdjustmentBps > 0) {
    rationale.push(
      `Stress adjustment: Tier ${tier} → ${stressedTier} under stress → +${stressAdjustmentBps}bps`,
    );
  } else if (stressedTier !== undefined) {
    rationale.push(
      `Stress adjustment: No tier degradation under stress → +0bps`,
    );
  }

  rationale.push(
    `Final rate: ${(finalRate * 100).toFixed(2)}%`,
  );

  return {
    product,
    baseRate: baseEntry.baseRate,
    riskPremiumBps,
    stressAdjustmentBps,
    finalRate,
    rationale,
  };
}
