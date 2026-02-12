/**
 * Memo Engine — Types
 *
 * Structured credit memo types.
 * Deterministic template-based memo generation (no LLM).
 *
 * PHASE 6: Pure memo generation — no DB, no UI.
 */

import type { ProductType } from "@/lib/creditLenses/types";
import type { ProductAnalysis } from "@/lib/creditLenses/types";
import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import type { PolicyResult } from "@/lib/policyEngine/types";
import type { StressResult } from "@/lib/stressEngine/types";
import type { PricingResult } from "@/lib/pricingEngine/types";

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export type RecommendationType =
  | "APPROVE"
  | "APPROVE_WITH_MITIGANTS"
  | "DECLINE_OR_RESTRUCTURE";

// ---------------------------------------------------------------------------
// Memo Section
// ---------------------------------------------------------------------------

export type MemoSectionKey =
  | "executiveSummary"
  | "transactionOverview"
  | "financialAnalysis"
  | "policyAssessment"
  | "stressAnalysis"
  | "pricingSummary"
  | "risksAndMitigants"
  | "recommendation";

export interface MemoSection {
  key: MemoSectionKey;
  title: string;
  content: string;
  bullets?: string[];
}

// ---------------------------------------------------------------------------
// Memo Input
// ---------------------------------------------------------------------------

export interface MemoInput {
  dealId: string;
  product: ProductType;
  snapshot: CreditSnapshot;
  analysis: ProductAnalysis;
  policy: PolicyResult;
  stress: StressResult;
  pricing: PricingResult;
}

// ---------------------------------------------------------------------------
// Credit Memo
// ---------------------------------------------------------------------------

export interface CreditMemo {
  dealId: string;
  product: ProductType;
  recommendation: RecommendationType;
  recommendationText: string;
  sections: Record<MemoSectionKey, MemoSection>;
  generatedAt: string;
}
