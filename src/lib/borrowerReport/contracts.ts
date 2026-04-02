/**
 * Borrower Insights Canonical Contract — Surgical Remediation
 *
 * Shared types and formatters for the borrower insights API.
 * Both GET and POST must return the same shape.
 * Both page and route must agree on this contract.
 */

import type { BorrowerInsightResult } from "./insightsEngine";

// ============================================================================
// Canonical API Response
// ============================================================================

export type BorrowerInsightsApiResponse = {
  ok: true;
  dealId: string;
  generatedAt: string;
  healthSummary: BorrowerInsightResult["healthSummary"];
  whatChanged: BorrowerInsightResult["whatChanged"];
  whatMatters: BorrowerInsightResult["whatMatters"];
  bankabilityActions: BorrowerInsightResult["bankabilityActions"];
  scenarios: BorrowerInsightResult["scenarios"];
  peerContext: BorrowerInsightResult["peerContext"];
  ratioExplanations: BorrowerInsightResult["ratioExplanations"];
};

// ============================================================================
// Engine Result → API Response
// ============================================================================

/**
 * Format a fresh engine result into the canonical API response.
 * Used by POST route after generation.
 */
export function toBorrowerInsightsApiResponse(
  result: BorrowerInsightResult,
): BorrowerInsightsApiResponse {
  return {
    ok: true,
    dealId: result.dealId,
    generatedAt: result.generatedAt,
    healthSummary: result.healthSummary,
    whatChanged: result.whatChanged,
    whatMatters: result.whatMatters,
    bankabilityActions: result.bankabilityActions,
    scenarios: result.scenarios,
    peerContext: result.peerContext,
    ratioExplanations: result.ratioExplanations,
  };
}

// ============================================================================
// Persisted DB Row → API Response
// ============================================================================

type BorrowerInsightRunRow = {
  deal_id: string;
  created_at: string;
  completed_at: string | null;
  insight_summary_json: any;
  scenario_json: any;
  benchmark_json: any;
};

/**
 * Reconstruct the canonical API response from a persisted DB row.
 * Used by GET route for replay without recomputation.
 *
 * Handles pre-fix rows gracefully — missing sections become empty defaults.
 */
export function borrowerInsightRunRowToApiResponse(
  row: BorrowerInsightRunRow,
): BorrowerInsightsApiResponse {
  const insight = row.insight_summary_json ?? {};

  const hasCanonicalPayload = !!insight.healthSummary && !!insight.whatMatters;
  if (!hasCanonicalPayload) {
    console.warn("[borrower-insights] incomplete persisted payload", {
      dealId: row.deal_id,
    });
  }

  return {
    ok: true,
    dealId: row.deal_id,
    generatedAt: row.completed_at ?? row.created_at,
    healthSummary: insight.healthSummary ?? {
      grade: "C",
      headline: "Insights are being regenerated.",
      strengths: [],
      concerns: [],
      overallScore: 0,
    },
    whatChanged: insight.whatChanged ?? null,
    whatMatters: insight.whatMatters ?? {
      loanType: "UNKNOWN",
      criticalMetrics: [],
    },
    bankabilityActions: insight.bankabilityActions ?? [],
    scenarios: row.scenario_json ?? [],
    peerContext: row.benchmark_json ?? null,
    ratioExplanations: insight.ratioExplanations ?? [],
  };
}
