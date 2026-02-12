/**
 * Config Engine — Types
 *
 * Per-bank configuration overrides for the underwriting pipeline.
 * Each override type is optional — missing fields fall back to system defaults.
 *
 * PHASE 8: Configuration layer — no computation, no DB, no UI.
 */

import type { ProductType } from "@/lib/creditLenses/types";
import type { RiskTier } from "@/lib/policyEngine/types";
import type { StressScenarioDefinition } from "@/lib/stressEngine/types";

// ---------------------------------------------------------------------------
// Bank Config (top-level)
// ---------------------------------------------------------------------------

export interface BankConfig {
  id: string;
  bankId: string;
  version: number;
  policy: PolicyConfigOverride;
  stress: StressConfigOverride;
  pricing: PricingConfigOverride;
}

// ---------------------------------------------------------------------------
// Policy Overrides
// ---------------------------------------------------------------------------

export interface PolicyConfigOverride {
  /** Per-product threshold overrides. Missing products use system defaults. */
  thresholds?: Array<{
    product: ProductType;
    metric: string;
    minimum?: number;
    maximum?: number;
  }>;
  /** Override for MINOR_BREACH_BAND (default 0.15) */
  minorBreachBand?: number;
}

// ---------------------------------------------------------------------------
// Stress Overrides
// ---------------------------------------------------------------------------

export interface StressConfigOverride {
  /** Custom scenarios. If provided, replaces system default scenarios entirely. */
  scenarios?: StressScenarioDefinition[];
}

// ---------------------------------------------------------------------------
// Pricing Overrides
// ---------------------------------------------------------------------------

export interface PricingConfigOverride {
  /** Per-product spread overrides in bps */
  spreads?: Partial<Record<ProductType, number>>;
  /** Per-tier risk premium overrides in bps */
  tierPremiums?: Partial<Record<RiskTier, number>>;
  /** Stress adjustment bps per tier degradation (default 25) */
  stressAdjustBpsPerTier?: number;
}
