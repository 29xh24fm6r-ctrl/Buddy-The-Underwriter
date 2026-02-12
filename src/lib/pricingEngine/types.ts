/**
 * Pricing Engine — Types
 *
 * Risk-based pricing computation types.
 * Base rates, tier premiums, stress adjustments, and final pricing.
 *
 * PHASE 5C: Pure pricing computation — no DB, no live rates, no UI.
 */

import type { ProductType } from "@/lib/creditLenses/types";
import type { RiskTier } from "@/lib/policyEngine/types";

// ---------------------------------------------------------------------------
// Base Rate
// ---------------------------------------------------------------------------

export type RateIndex = "PRIME" | "SOFR";

export interface BaseRateEntry {
  product: ProductType;
  index: RateIndex;
  /** Index rate as decimal (e.g. 0.085 for 8.50%) */
  indexRate: number;
  /** Spread over index in basis points */
  spreadBps: number;
  /** Computed base rate as decimal (indexRate + spreadBps/10000) */
  baseRate: number;
}

// ---------------------------------------------------------------------------
// Pricing Options
// ---------------------------------------------------------------------------

export interface PricingOpts {
  product: ProductType;
  tier: RiskTier;
  /** Worst stress tier — used for stress adjustment. If omitted, no stress adjustment. */
  stressedTier?: RiskTier;
}

// ---------------------------------------------------------------------------
// Pricing Result
// ---------------------------------------------------------------------------

export interface PricingResult {
  product: ProductType;
  /** Base rate before risk adjustments (decimal) */
  baseRate: number;
  /** Risk premium in basis points based on policy tier */
  riskPremiumBps: number;
  /** Stress adjustment in basis points based on tier degradation */
  stressAdjustmentBps: number;
  /** Final all-in rate (decimal): baseRate + (riskPremiumBps + stressAdjustmentBps) / 10000 */
  finalRate: number;
  /** Human-readable rationale for each pricing component */
  rationale: string[];
}
