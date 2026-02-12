/**
 * Memo Engine — Public API
 *
 * Generates a structured credit memo from underwriting results.
 * All sections are deterministic template-based (no LLM).
 *
 * PHASE 6: Pure memo generation — no DB, no UI.
 */

import type { CreditMemo, MemoInput, MemoSectionKey, MemoSection } from "./types";
import { getRecommendation } from "./recommendation";
import {
  buildExecutiveSummary,
  buildTransactionOverview,
  buildFinancialAnalysis,
  buildPolicyAssessment,
  buildStressAnalysis,
  buildPricingSummary,
  buildRisksAndMitigants,
  buildRecommendation,
} from "./sections";

// Re-export types
export type {
  CreditMemo,
  MemoInput,
  MemoSection,
  MemoSectionKey,
  RecommendationType,
} from "./types";

// Re-export sub-modules
export { getRecommendation } from "./recommendation";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a structured credit memo from underwriting results.
 *
 * Composes 8 deterministic sections from:
 * - CreditSnapshot (financial data)
 * - ProductAnalysis (lens interpretation)
 * - PolicyResult (threshold evaluation)
 * - StressResult (scenario analysis)
 * - PricingResult (rate computation)
 *
 * Pure function — deterministic, no side effects.
 */
export function generateMemo(input: MemoInput): CreditMemo {
  const rec = getRecommendation(input.policy.tier);

  const sections: Record<MemoSectionKey, MemoSection> = {
    executiveSummary: buildExecutiveSummary(input),
    transactionOverview: buildTransactionOverview(input),
    financialAnalysis: buildFinancialAnalysis(input),
    policyAssessment: buildPolicyAssessment(input),
    stressAnalysis: buildStressAnalysis(input),
    pricingSummary: buildPricingSummary(input),
    risksAndMitigants: buildRisksAndMitigants(input),
    recommendation: buildRecommendation(input),
  };

  return {
    dealId: input.dealId,
    product: input.product,
    recommendation: rec.type,
    recommendationText: rec.text,
    sections,
    generatedAt: new Date().toISOString(),
  };
}
