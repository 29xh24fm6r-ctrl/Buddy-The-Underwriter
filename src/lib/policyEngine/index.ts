/**
 * Policy Engine — Public API
 *
 * Composes credit lenses (interpretation) with policy evaluation (thresholds).
 *
 * PHASE 5: Policy layer only — no pricing, no lifecycle mutation, no UI.
 */

import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import type { ProductType, ProductAnalysis } from "@/lib/creditLenses/types";
import { computeProductAnalysis } from "@/lib/creditLenses";
import type { PolicyResult } from "./types";
import { evaluatePolicy } from "./evaluator";

// Re-export types
export type {
  PolicyThreshold,
  PolicyDefinition,
  PolicyResult,
  RiskTier,
  BreachSeverity,
  ThresholdBreach,
} from "./types";

// Re-export sub-modules
export { getPolicyDefinition, MINOR_BREACH_BAND } from "./policies";
export { evaluatePolicy } from "./evaluator";

// ---------------------------------------------------------------------------
// Composed decision
// ---------------------------------------------------------------------------

export interface PolicyDecision {
  analysis: ProductAnalysis;
  policy: PolicyResult;
}

/**
 * Compute a full policy decision: product lens analysis + policy evaluation.
 *
 * Composes Phase 4B (interpretation) with Phase 5 (thresholds).
 *
 * Pure function — deterministic, no side effects.
 */
export function computePolicyDecision(
  snapshot: CreditSnapshot,
  product: ProductType,
): PolicyDecision {
  const analysis = computeProductAnalysis(snapshot, product);
  const policy = evaluatePolicy(snapshot, product);
  return { analysis, policy };
}
