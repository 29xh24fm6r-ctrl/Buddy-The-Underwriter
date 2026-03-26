/**
 * Phase 55E — Deterministic Exception Narrative Builder
 *
 * Generates analyst-grade, committee-safe language for each exception.
 * No AI, no generative prose — deterministic templates only.
 */

import type { ExceptionKind, ExceptionCategory, ExceptionSeverity, ExceptionRecommendation } from "./exception-types";

type NarrativeInput = {
  kind: ExceptionKind;
  category: ExceptionCategory;
  severity: ExceptionSeverity;
  factKey: string | null;
  periodKey: string | null;
  status: "open" | "resolved" | "deferred";
  bankerAction?: string | null;
  priorValue?: number | null;
  resolvedValue?: number | null;
};

type NarrativeOutput = {
  title: string;
  summary: string;
  whyItMatters: string;
  recommendedAction: ExceptionRecommendation;
  committeeDisclosure: string | null;
};

const CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  cash_flow: "cash flow",
  leverage: "leverage",
  liquidity: "liquidity",
  collateral: "collateral",
  guarantor: "guarantor strength",
  reporting_quality: "reporting quality",
  earnings_quality: "earnings quality",
  debt_service: "debt service coverage",
  working_capital: "working capital",
  global_cash_flow: "global cash flow",
  tax_return_reconciliation: "tax return reconciliation",
  other: "financial analysis",
};

/**
 * Build deterministic narrative for a financial exception.
 */
export function buildExceptionNarrative(input: NarrativeInput): NarrativeOutput {
  const factLabel = input.factKey?.replace(/_/g, " ") ?? "a financial metric";
  const catLabel = CATEGORY_LABELS[input.category] ?? "financial analysis";
  const period = input.periodKey ? ` for ${input.periodKey}` : "";

  switch (input.kind) {
    case "missing_critical_metric":
      return {
        title: `Missing: ${factLabel}${period}`,
        summary: `A required ${catLabel} metric (${factLabel}) is not available${period}.`,
        whyItMatters: `Without ${factLabel}, the ${catLabel} analysis is incomplete and may not support a fully informed credit decision.`,
        recommendedAction: "request_supporting_document",
        committeeDisclosure: input.severity === "critical"
          ? `${factLabel} is missing from the financial snapshot. This metric is required for ${catLabel} assessment.`
          : null,
      };

    case "unresolved_conflict":
      return {
        title: `Conflict: ${factLabel}${period}`,
        summary: `Competing source values exist for ${factLabel}${period} and have not been resolved.`,
        whyItMatters: `An unresolved conflict in ${catLabel} creates uncertainty in the underwriting view. The banker must select the authoritative source.`,
        recommendedAction: "banker_review_required",
        committeeDisclosure: `A conflict remains between uploaded source materials for ${factLabel}. Because ${catLabel} metrics are decision-relevant, this item should be resolved before final committee action.`,
      };

    case "low_confidence_required_fact":
      return {
        title: `Low confidence: ${factLabel}${period}`,
        summary: `${factLabel}${period} was extracted with low confidence and may not be reliable.`,
        whyItMatters: `Low-confidence values in ${catLabel} may not accurately represent the borrower's financial position.`,
        recommendedAction: "banker_review_required",
        committeeDisclosure: null,
      };

    case "stale_snapshot":
      return {
        title: "Financial snapshot is stale",
        summary: "Newer financial evidence exists that is not reflected in the current snapshot.",
        whyItMatters: "Committee artifacts may not reflect the most current financial data available.",
        recommendedAction: "rebuild_snapshot",
        committeeDisclosure: "The financial snapshot is stale relative to the latest uploaded evidence. A rebuild is recommended before committee finalization.",
      };

    case "banker_override":
      return {
        title: `Override: ${factLabel}${period}`,
        summary: `${factLabel}${period} was adjusted by the banker from ${formatValue(input.priorValue)} to ${formatValue(input.resolvedValue)}.`,
        whyItMatters: `A banker adjustment to a ${catLabel} metric means the committee view differs from the source-extracted value. The rationale should be reviewed.`,
        recommendedAction: "committee_disclosure_required",
        committeeDisclosure: `${factLabel}${period} was adjusted by the reviewing banker. Original source value: ${formatValue(input.priorValue)}. Adjusted value: ${formatValue(input.resolvedValue)}.`,
      };

    case "manual_provided_value":
      return {
        title: `Manual value: ${factLabel}${period}`,
        summary: `${factLabel}${period} was manually entered rather than extracted from uploaded documents.`,
        whyItMatters: `Manual values in ${catLabel} are not backed by uploaded supporting evidence and may warrant additional documentation.`,
        recommendedAction: "request_supporting_document",
        committeeDisclosure: input.severity === "high" || input.severity === "critical"
          ? `${factLabel}${period} was manually provided and is not yet backed by uploaded supporting documentation.`
          : null,
      };

    case "deferred_follow_up":
      return {
        title: `Follow-up: ${factLabel}${period}`,
        summary: `A review follow-up was deferred for ${factLabel}${period}.`,
        whyItMatters: `Deferred items in ${catLabel} should be tracked as conditions or covenants to ensure resolution post-close.`,
        recommendedAction: "add_credit_condition",
        committeeDisclosure: null,
      };

    case "material_change_after_memo":
      return {
        title: `Post-memo change: ${factLabel}${period}`,
        summary: `${factLabel}${period} changed materially after the current memo was generated.`,
        whyItMatters: "The credit memo may not reflect the most current financial data. Regeneration is recommended.",
        recommendedAction: "regenerate_memo",
        committeeDisclosure: `A material financial change was detected after memo generation. The memo should be regenerated to reflect current data.`,
      };
  }
}

function formatValue(v: number | null | undefined): string {
  if (v == null) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
}
