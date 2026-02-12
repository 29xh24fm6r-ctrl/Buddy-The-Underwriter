/**
 * Stress Engine — Types
 *
 * Institutional stress testing types.
 * Scenario definitions, results, and aggregate stress analysis.
 *
 * PHASE 5B: Pure stress computation — no DB, no pricing, no UI.
 */

import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import type { PolicyResult, RiskTier } from "@/lib/policyEngine/types";

// ---------------------------------------------------------------------------
// Scenario Keys
// ---------------------------------------------------------------------------

export type StressScenarioKey =
  | "BASELINE"
  | "EBITDA_10_DOWN"
  | "REVENUE_10_DOWN"
  | "RATE_PLUS_200"
  | "COMBINED_MODERATE";

// ---------------------------------------------------------------------------
// Scenario Definition
// ---------------------------------------------------------------------------

export interface StressScenarioDefinition {
  key: StressScenarioKey;
  label: string;
  /** EBITDA haircut as decimal (e.g. 0.10 = 10% reduction) */
  ebitdaHaircut?: number;
  /** Revenue haircut as decimal (e.g. 0.10 = 10% reduction) */
  revenueHaircut?: number;
  /** Rate shock in basis points (e.g. 200 = +2.00%) */
  rateShockBps?: number;
}

// ---------------------------------------------------------------------------
// Per-Scenario Result
// ---------------------------------------------------------------------------

export interface StressScenarioResult {
  key: StressScenarioKey;
  label: string;
  snapshot: CreditSnapshot;
  policy: PolicyResult;
  /** Change in DSCR vs baseline (negative = deterioration) */
  dscrDelta?: number;
  /** Change in annual debt service vs baseline (positive = more DS) */
  debtServiceDelta?: number;
}

// ---------------------------------------------------------------------------
// Aggregate Stress Result
// ---------------------------------------------------------------------------

export interface StressResult {
  baseline: StressScenarioResult;
  scenarios: StressScenarioResult[];
  /** Worst risk tier across all scenarios (D > C > B > A) */
  worstTier: RiskTier;
  /** True if any scenario produced a worse tier than baseline */
  tierDegraded: boolean;
}
