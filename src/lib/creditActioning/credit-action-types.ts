/**
 * Phase 55F — Credit Action Recommendation Types
 */

export type CreditActionType =
  | "add_condition"
  | "add_covenant"
  | "add_reporting_requirement"
  | "request_updated_financials"
  | "request_supporting_document"
  | "pricing_review"
  | "structure_review"
  | "add_collateral_support"
  | "add_guaranty_support"
  | "committee_discussion_item"
  | "memo_regeneration_required"
  | "packet_regeneration_required"
  | "monitoring_recommendation"
  | "no_action";

export type ActionCategory =
  | "cash_flow"
  | "leverage"
  | "liquidity"
  | "collateral"
  | "guarantor"
  | "reporting_quality"
  | "earnings_quality"
  | "working_capital"
  | "global_cash_flow"
  | "operational_risk"
  | "policy_proximity"
  | "other";

export type ActionPriority = "immediate" | "pre_committee" | "pre_close" | "post_close";
export type ActionStatus = "proposed" | "accepted" | "modified" | "dismissed" | "implemented";

export type ActionTargetSystem =
  | "conditions"
  | "covenants"
  | "pricing"
  | "memo"
  | "committee_packet"
  | "borrower_requests"
  | "monitoring";

export type ProposedTerms = {
  covenantMetric?: string | null;
  threshold?: number | string | null;
  testingFrequency?: "monthly" | "quarterly" | "annually" | null;
  reportingRequirement?: string | null;
  conditionText?: string | null;
  pricingAdjustmentBps?: number | null;
  collateralRequirement?: string | null;
  guarantyRequirement?: string | null;
};

export type CreditActionRecommendation = {
  id: string;
  dealId: string;
  sourceExceptionId: string | null;
  actionType: CreditActionType;
  category: ActionCategory;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  priority: ActionPriority;
  recommendedText: string;
  rationale: string;
  committeeImpact: string | null;
  proposedTerms: ProposedTerms;
  status: ActionStatus;
  evidence: {
    exceptionKind?: string | null;
    factKey?: string | null;
    periodKey?: string | null;
    bankerResolutionId?: string | null;
  };
};

export type ActionRegistryEntry = {
  actionType: CreditActionType;
  targetSystem: ActionTargetSystem;
  bankerEditable: boolean;
  requiresAcceptance: boolean;
  requiresCommitteeDisclosure: boolean;
};

export const ACTION_REGISTRY: ActionRegistryEntry[] = [
  { actionType: "add_condition", targetSystem: "conditions", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: false },
  { actionType: "add_covenant", targetSystem: "covenants", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: true },
  { actionType: "add_reporting_requirement", targetSystem: "covenants", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: false },
  { actionType: "request_updated_financials", targetSystem: "borrower_requests", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: false },
  { actionType: "request_supporting_document", targetSystem: "borrower_requests", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: false },
  { actionType: "pricing_review", targetSystem: "pricing", bankerEditable: false, requiresAcceptance: true, requiresCommitteeDisclosure: true },
  { actionType: "structure_review", targetSystem: "pricing", bankerEditable: false, requiresAcceptance: true, requiresCommitteeDisclosure: true },
  { actionType: "add_collateral_support", targetSystem: "conditions", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: false },
  { actionType: "add_guaranty_support", targetSystem: "conditions", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: false },
  { actionType: "committee_discussion_item", targetSystem: "committee_packet", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: true },
  { actionType: "memo_regeneration_required", targetSystem: "memo", bankerEditable: false, requiresAcceptance: false, requiresCommitteeDisclosure: false },
  { actionType: "packet_regeneration_required", targetSystem: "committee_packet", bankerEditable: false, requiresAcceptance: false, requiresCommitteeDisclosure: false },
  { actionType: "monitoring_recommendation", targetSystem: "monitoring", bankerEditable: true, requiresAcceptance: true, requiresCommitteeDisclosure: false },
  { actionType: "no_action", targetSystem: "memo", bankerEditable: false, requiresAcceptance: false, requiresCommitteeDisclosure: false },
];
