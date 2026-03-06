/**
 * Spread Output Layer — Type Definitions
 *
 * Pure types for the Five Panel Spread Output.
 * No runtime imports, no server-only.
 */

import type { QualityOfEarningsReport } from "../spreads/qoeEngine";
import type { TrendAnalysisResult } from "../trends/trendAnalysis";
import type { ConsolidationResult } from "../consolidation/consolidationEngine";
import type { FlagEngineOutput } from "../flagEngine/types";

// ---------------------------------------------------------------------------
// Re-export upstream types under spec names
// ---------------------------------------------------------------------------

export type QoEReport = QualityOfEarningsReport;
export type TrendReport = TrendAnalysisResult;
export type ConsolidatedSpread = ConsolidationResult;

// ---------------------------------------------------------------------------
// Deal Type
// ---------------------------------------------------------------------------

export type DealType =
  | "c_and_i"
  | "cre_owner_occupied"
  | "cre_investor"
  | "cre_construction"
  | "sba_7a"
  | "sba_504"
  | "agriculture"
  | "multifamily"
  | "healthcare"
  | "franchise"
  | "professional_practice"
  | "non_profit"
  | "holding_company"
  | "acquisition"
  | "equipment"
  | "working_capital";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SpreadOutputInput {
  deal_id: string;
  deal_type: DealType;
  canonical_facts: Record<string, unknown>;
  ratios: Record<string, number | null>;
  years_available: number[];
  qoe_report?: QoEReport;
  trend_report?: TrendReport;
  consolidated_spread?: ConsolidatedSpread;
  flag_report?: FlagEngineOutput;
  bank_policy?: BankPolicyConfig;
}

export interface BankPolicyConfig {
  dscr_minimum: number;
  fccr_minimum: number;
  current_ratio_minimum: number;
  ltv_maximum: number;
  ltc_maximum: number;
  debt_ebitda_maximum: number;
  post_close_liquidity_pct: number;
}

export const DEFAULT_BANK_POLICY: BankPolicyConfig = {
  dscr_minimum: 1.25,
  fccr_minimum: 1.15,
  current_ratio_minimum: 1.10,
  ltv_maximum: 0.75,
  ltc_maximum: 0.80,
  debt_ebitda_maximum: 4.5,
  post_close_liquidity_pct: 0.10,
};

// ---------------------------------------------------------------------------
// Output — SpreadOutputReport
// ---------------------------------------------------------------------------

export interface SpreadOutputReport {
  deal_id: string;
  deal_type: DealType;
  executive_summary: ExecutiveSummary;
  normalized_spread: NormalizedSpread;
  ratio_scorecard: RatioScorecardReport;
  story_panel: StoryPanel;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Panel 1 — Executive Summary
// ---------------------------------------------------------------------------

export type RecommendationLevel = "strong" | "adequate" | "marginal" | "insufficient";

export interface ExecutiveSummary {
  business_overview: string;
  financial_snapshot: string;
  coverage_summary: string;
  collateral_summary: string;
  risk_flags_summary: string;
  recommendation_language: string;
  recommendation_level: RecommendationLevel;
}

// ---------------------------------------------------------------------------
// Panel 2 — Normalized Spread
// ---------------------------------------------------------------------------

export interface NormalizedSpread {
  years: number[];
  line_items: NormalizedLineItem[];
}

export type LineItemCategory =
  | "revenue"
  | "cogs"
  | "expense"
  | "ebitda"
  | "debt_service"
  | "ratio"
  | "balance_sheet";

export interface NormalizedLineItem {
  label: string;
  canonical_key: string;
  values: Record<
    number,
    {
      reported: number | null;
      adjustments: SpreadAdjustment[];
      normalized: number | null;
      trend: "up" | "down" | "flat" | null;
      trend_pct: number | null;
    }
  >;
  category: LineItemCategory;
}

export interface SpreadAdjustment {
  label: string;
  amount: number;
  source: string;
  type: "qoe" | "owner_benefit" | "depreciation" | "normalization" | "intercompany";
}

// ---------------------------------------------------------------------------
// Panel 3 — Ratio Scorecard
// ---------------------------------------------------------------------------

export type RatioAssessment = "strong" | "adequate" | "weak" | "concerning" | null;

export interface RatioScorecardReport {
  groups: RatioGroup[];
  overall_assessment: "strong" | "adequate" | "marginal" | "insufficient";
}

export interface RatioGroup {
  group_name: string;
  ratios: RatioScorecardItem[];
}

export interface RatioScorecardItem {
  label: string;
  canonical_key: string;
  value: number | null;
  formatted_value: string;
  percentile: number | null;
  assessment: RatioAssessment;
  peer_median: number | null;
  policy_minimum: number | null;
  policy_maximum: number | null;
  passes_policy: boolean | null;
  narrative: string;
  trend: "improving" | "stable" | "deteriorating" | null;
}

// ---------------------------------------------------------------------------
// Panel 5 — Story Panel
// ---------------------------------------------------------------------------

export interface StoryPanel {
  top_risks: StoryElement[];
  top_strengths: StoryElement[];
  resolution_narrative: string;
  covenant_suggestions: CovenantSuggestion[];
  final_narrative: string;
}

export interface StoryElement {
  title: string;
  narrative: string;
  severity?: "critical" | "elevated" | "watch";
}

export interface CovenantSuggestion {
  covenant_type: string;
  description: string;
  rationale: string;
  canonical_key: string;
  threshold: number;
  frequency: "monthly" | "quarterly" | "annually";
}
