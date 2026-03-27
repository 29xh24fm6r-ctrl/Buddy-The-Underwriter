/**
 * Action Engine Types — Phase 65D
 *
 * nextActions are derived from canonical state only.
 * Omega may NEVER influence action generation.
 */

export type BuddyActionPriority = "critical" | "high" | "normal";

export type BuddyActionCode =
  | "request_documents"
  | "review_uploaded_documents"
  | "finalize_document_classification"
  | "resolve_readiness_blockers"
  | "set_pricing_assumptions"
  | "run_extraction"
  | "review_extracted_data"
  | "generate_financial_snapshot"
  | "finalize_risk_pricing"
  | "complete_structural_pricing"
  | "commit_pricing_quote"
  | "generate_committee_packet"
  | "resolve_critical_flags"
  | "record_committee_decision"
  | "complete_attestation"
  | "seed_checklist"
  | "submit_loan_request"
  | "start_underwriting"
  | "review_credit_memo"
  | "start_closing"
  | "complete_closing"
  | "no_action_required";

export type BuddyNextAction = {
  code: BuddyActionCode;
  label: string;
  description: string;
  priority: BuddyActionPriority;
  blockingFactorCodes: string[];
  source: "canonical";
};

export type BuddyActionDerivationInput = {
  canonicalState: import("@/core/state/types").BuddyCanonicalState;
  explanation: import("@/core/explanation/types").BuddyExplanation;
};

export type BuddyActionDerivationResult = {
  nextActions: BuddyNextAction[];
  primaryAction: BuddyNextAction | null;
};
