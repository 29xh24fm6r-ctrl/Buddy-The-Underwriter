/**
 * Phase 55E — Financial Exception Types
 */

export type ExceptionKind =
  | "missing_critical_metric"
  | "unresolved_conflict"
  | "low_confidence_required_fact"
  | "stale_snapshot"
  | "banker_override"
  | "manual_provided_value"
  | "deferred_follow_up"
  | "material_change_after_memo";

export type ExceptionCategory =
  | "cash_flow"
  | "leverage"
  | "liquidity"
  | "collateral"
  | "guarantor"
  | "reporting_quality"
  | "earnings_quality"
  | "debt_service"
  | "working_capital"
  | "global_cash_flow"
  | "tax_return_reconciliation"
  | "other";

export type ExceptionSeverity = "info" | "low" | "moderate" | "high" | "critical";

export type DecisionImpact =
  | "none"
  | "memo_disclosure"
  | "needs_banker_follow_up"
  | "needs_borrower_follow_up"
  | "structure_review"
  | "pricing_review"
  | "committee_attention"
  | "decision_blocking";

export type ExceptionRecommendation =
  | "request_updated_financials"
  | "request_borrower_clarification"
  | "request_supporting_document"
  | "banker_review_required"
  | "rebuild_snapshot"
  | "regenerate_memo"
  | "pricing_review"
  | "structure_review"
  | "add_credit_condition"
  | "add_reporting_covenant"
  | "committee_disclosure_required"
  | "no_action";

export type FinancialException = {
  id: string;
  dealId: string;
  kind: ExceptionKind;
  category: ExceptionCategory;
  severity: ExceptionSeverity;
  decisionImpact: DecisionImpact;
  status: "open" | "resolved" | "deferred";
  source: "snapshot_gate" | "gap_queue" | "resolution_audit" | "snapshot_diff" | "memo_staleness";
  factKey: string | null;
  periodKey: string | null;
  title: string;
  summary: string;
  whyItMatters: string;
  recommendedAction: ExceptionRecommendation | null;
  committeeDisclosure: string | null;
  evidence: {
    gapType?: string | null;
    validationState?: string | null;
    blockerCode?: string | null;
    sourceDocumentName?: string | null;
    confidence?: number | null;
    bankerAction?: string | null;
    bankerRationale?: string | null;
    priorValue?: number | null;
    resolvedValue?: number | null;
    snapshotBuiltAt?: string | null;
  };
};

export type OverrideInsight = {
  factKey: string;
  periodKey: string | null;
  buddyValue: number | null;
  bankerValue: number | null;
  delta: number | null;
  deltaPct: number | null;
  direction: "conservative" | "neutral" | "aggressive" | "unknown";
  material: boolean;
  rationaleQuality: "strong" | "adequate" | "weak";
  requiresCommitteeDisclosure: boolean;
};
