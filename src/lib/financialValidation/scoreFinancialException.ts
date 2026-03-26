/**
 * Phase 55E — Exception Severity Scorer + Category Mapper
 *
 * Pure deterministic rules. No AI, no prompts.
 */

import type { ExceptionKind, ExceptionCategory, ExceptionSeverity, DecisionImpact } from "./exception-types";

// ---------------------------------------------------------------------------
// Fact → Category mapping
// ---------------------------------------------------------------------------

const FACT_CATEGORY_MAP: Record<string, ExceptionCategory> = {
  revenue: "cash_flow",
  total_revenue: "cash_flow",
  gross_revenue: "cash_flow",
  ebitda: "cash_flow",
  ebitda_ttm: "cash_flow",
  net_income: "earnings_quality",
  net_operating_income: "cash_flow",
  noi: "cash_flow",
  noi_ttm: "cash_flow",
  dscr: "debt_service",
  dscr_ttm: "debt_service",
  debt_service_coverage: "debt_service",
  annual_debt_service: "debt_service",
  total_debt: "leverage",
  funded_debt: "leverage",
  total_liabilities: "leverage",
  ltv: "collateral",
  loan_to_value: "collateral",
  collateral_value: "collateral",
  appraised_value: "collateral",
  current_ratio: "liquidity",
  quick_ratio: "liquidity",
  working_capital: "working_capital",
  accounts_receivable: "working_capital",
  inventory: "working_capital",
  guarantor_liquidity: "guarantor",
  guarantor_net_worth: "guarantor",
  global_dscr: "global_cash_flow",
  global_cash_flow: "global_cash_flow",
  tax_return_revenue: "tax_return_reconciliation",
};

const DECISION_CRITICAL_CATEGORIES = new Set<ExceptionCategory>([
  "debt_service", "cash_flow", "leverage", "collateral", "global_cash_flow",
]);

/**
 * Map a fact key to its credit risk category.
 */
export function categorizeFactKey(factKey: string | null): ExceptionCategory {
  if (!factKey) return "other";
  const lower = factKey.toLowerCase().replace(/[^a-z_]/g, "");
  return FACT_CATEGORY_MAP[lower] ?? "other";
}

/**
 * Score severity for a financial exception.
 * Pure function.
 */
export function scoreExceptionSeverity(input: {
  kind: ExceptionKind;
  category: ExceptionCategory;
  isDecisionCriticalCategory: boolean;
  isPostMemo: boolean;
  hasWeakRationale: boolean;
}): ExceptionSeverity {
  const { kind, category, isDecisionCriticalCategory, isPostMemo, hasWeakRationale } = input;

  // Critical: post-memo changes, unresolved decision-critical conflicts, missing critical metrics
  if (kind === "material_change_after_memo" && isDecisionCriticalCategory) return "critical";
  if (kind === "stale_snapshot" && isPostMemo) return "critical";
  if (kind === "unresolved_conflict" && isDecisionCriticalCategory) return "critical";
  if (kind === "missing_critical_metric" && isDecisionCriticalCategory) return "critical";
  if (kind === "banker_override" && isDecisionCriticalCategory && hasWeakRationale) return "critical";

  // High: non-blocking conflicts, repeated overrides, deferred follow-ups on core metrics
  if (kind === "unresolved_conflict") return "high";
  if (kind === "missing_critical_metric") return "high";
  if (kind === "banker_override" && isDecisionCriticalCategory) return "high";
  if (kind === "deferred_follow_up" && isDecisionCriticalCategory) return "high";
  if (kind === "stale_snapshot") return "high";

  // Moderate: low confidence, manual values, non-critical overrides
  if (kind === "low_confidence_required_fact") return "moderate";
  if (kind === "manual_provided_value") return "moderate";
  if (kind === "banker_override") return "moderate";
  if (kind === "deferred_follow_up") return "moderate";

  // Info/Low
  if (kind === "material_change_after_memo") return "low";
  return "info";
}

/**
 * Determine decision impact for a financial exception.
 */
export function scoreDecisionImpact(input: {
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  category: ExceptionCategory;
  status: "open" | "resolved" | "deferred";
}): DecisionImpact {
  const { kind, severity, status } = input;

  if (status === "resolved" && severity !== "critical") return "memo_disclosure";

  if (severity === "critical" && status === "open") return "decision_blocking";
  if (kind === "material_change_after_memo") return "committee_attention";
  if (kind === "unresolved_conflict" && severity === "high") return "committee_attention";
  if (kind === "banker_override" && severity === "high") return "committee_attention";
  if (kind === "stale_snapshot") return "needs_banker_follow_up";
  if (kind === "missing_critical_metric") return "needs_borrower_follow_up";
  if (kind === "deferred_follow_up") return "needs_banker_follow_up";
  if (kind === "low_confidence_required_fact") return "needs_banker_follow_up";

  if (severity === "moderate") return "memo_disclosure";
  return "none";
}

/**
 * Check if a category is decision-critical.
 */
export function isDecisionCriticalCategory(category: ExceptionCategory): boolean {
  return DECISION_CRITICAL_CATEGORIES.has(category);
}
