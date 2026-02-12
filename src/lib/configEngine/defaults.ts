/**
 * Config Engine — System Defaults
 *
 * Hard-coded default values that match the current engine behavior.
 * Bank configs override these; when no bank config exists, these apply.
 *
 * PHASE 8: Constants only — no DB, no side effects.
 */

import type { ProductType } from "@/lib/creditLenses/types";
import type { RiskTier } from "@/lib/policyEngine/types";

// ---------------------------------------------------------------------------
// Policy defaults (matches policyEngine/policies.ts)
// ---------------------------------------------------------------------------

export const DEFAULT_MINOR_BREACH_BAND = 0.15;

export const DEFAULT_THRESHOLDS: Array<{
  product: ProductType;
  metric: string;
  minimum?: number;
  maximum?: number;
}> = [
  { product: "SBA", metric: "dscr", minimum: 1.25 },
  { product: "SBA", metric: "leverage", maximum: 4.0 },
  { product: "LOC", metric: "currentRatio", minimum: 1.0 },
  { product: "EQUIPMENT", metric: "dscr", minimum: 1.15 },
  { product: "ACQUISITION", metric: "leverage", maximum: 5.0 },
  { product: "ACQUISITION", metric: "dscr", minimum: 1.2 },
  { product: "CRE", metric: "dscr", minimum: 1.25 },
];

// ---------------------------------------------------------------------------
// Pricing defaults (matches pricingEngine/rateTable.ts + riskPremium.ts)
// ---------------------------------------------------------------------------

export const DEFAULT_SPREADS_BPS: Record<ProductType, number> = {
  SBA: 275,
  LOC: 150,
  EQUIPMENT: 200,
  ACQUISITION: 300,
  CRE: 225,
};

export const DEFAULT_TIER_PREMIUMS_BPS: Record<RiskTier, number> = {
  A: 0,
  B: 50,
  C: 125,
  D: 300,
};

export const DEFAULT_STRESS_ADJUST_BPS_PER_TIER = 25;
