/**
 * Policy Engine — Types
 *
 * Product-specific policy evaluation types.
 * Thresholds, definitions, results, and risk tiers.
 *
 * PHASE 5: Policy layer only — no pricing, no lifecycle mutation, no UI.
 */

import type { ProductType } from "@/lib/creditLenses/types";

// ---------------------------------------------------------------------------
// Risk Tier
// ---------------------------------------------------------------------------

export type RiskTier = "A" | "B" | "C" | "D";

// ---------------------------------------------------------------------------
// Policy Threshold
// ---------------------------------------------------------------------------

export interface PolicyThreshold {
  /** Metric key matching CreditSnapshot ratios (e.g. "dscr", "leverage") */
  metric: string;
  /** Minimum acceptable value (fail if below) */
  minimum?: number;
  /** Maximum acceptable value (fail if above) */
  maximum?: number;
}

// ---------------------------------------------------------------------------
// Policy Definition
// ---------------------------------------------------------------------------

export interface PolicyDefinition {
  product: ProductType;
  thresholds: PolicyThreshold[];
}

// ---------------------------------------------------------------------------
// Threshold Evaluation
// ---------------------------------------------------------------------------

export type BreachSeverity = "minor" | "severe";

export interface ThresholdBreach {
  metric: string;
  threshold: PolicyThreshold;
  actualValue: number;
  severity: BreachSeverity;
  /** Percentage deviation from threshold (e.g. 0.12 = 12% below minimum) */
  deviation: number;
}

// ---------------------------------------------------------------------------
// Policy Result
// ---------------------------------------------------------------------------

export interface PolicyResult {
  product: ProductType;
  passed: boolean;
  failedMetrics: string[];
  breaches: ThresholdBreach[];
  warnings: string[];
  metricsEvaluated: Record<string, number | undefined>;
  tier: RiskTier;
}
