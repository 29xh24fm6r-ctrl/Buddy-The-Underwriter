/**
 * Action Catalog — Phase 65D
 *
 * Central catalog: labels and descriptions defined once.
 * All action semantics come from here — UI never invents them.
 */

import type { BuddyActionCode, BuddyNextAction } from "./types";

type ActionTemplate = Omit<BuddyNextAction, "blockingFactorCodes">;

export const ACTION_CATALOG: Record<BuddyActionCode, ActionTemplate> = {
  seed_checklist: {
    code: "seed_checklist",
    label: "Initialize Checklist",
    description: "Deal checklist must be initialized before document collection can begin.",
    priority: "critical",
    source: "canonical",
  },
  request_documents: {
    code: "request_documents",
    label: "Request Documents",
    description: "Required documents must be requested or uploaded before readiness can improve.",
    priority: "critical",
    source: "canonical",
  },
  review_uploaded_documents: {
    code: "review_uploaded_documents",
    label: "Review Uploaded Documents",
    description: "Uploaded documents should be reviewed to confirm completeness and correctness.",
    priority: "high",
    source: "canonical",
  },
  finalize_document_classification: {
    code: "finalize_document_classification",
    label: "Finalize Document Classification",
    description: "Documents require AI review before readiness can advance.",
    priority: "critical",
    source: "canonical",
  },
  resolve_readiness_blockers: {
    code: "resolve_readiness_blockers",
    label: "Resolve Readiness Blockers",
    description: "Outstanding blockers must be resolved before the deal can move forward.",
    priority: "critical",
    source: "canonical",
  },
  set_pricing_assumptions: {
    code: "set_pricing_assumptions",
    label: "Set Pricing Assumptions",
    description: "Pricing assumptions are required before underwriting can begin.",
    priority: "critical",
    source: "canonical",
  },
  run_extraction: {
    code: "run_extraction",
    label: "Run Extraction",
    description: "Structured extraction must be completed before builder and memo workflows can progress.",
    priority: "high",
    source: "canonical",
  },
  review_extracted_data: {
    code: "review_extracted_data",
    label: "Review Extracted Data",
    description: "Extracted data should be reviewed before relying on it downstream.",
    priority: "high",
    source: "canonical",
  },
  generate_financial_snapshot: {
    code: "generate_financial_snapshot",
    label: "Generate Financial Snapshot",
    description: "A financial snapshot must be generated before underwriting can proceed.",
    priority: "critical",
    source: "canonical",
  },
  finalize_risk_pricing: {
    code: "finalize_risk_pricing",
    label: "Finalize Risk Pricing",
    description: "Risk-based pricing analysis must be finalized.",
    priority: "critical",
    source: "canonical",
  },
  complete_structural_pricing: {
    code: "complete_structural_pricing",
    label: "Complete Structural Pricing",
    description: "Structural pricing terms must be completed.",
    priority: "critical",
    source: "canonical",
  },
  commit_pricing_quote: {
    code: "commit_pricing_quote",
    label: "Commit Pricing Quote",
    description: "Pricing quote must be committed before committee submission.",
    priority: "critical",
    source: "canonical",
  },
  generate_committee_packet: {
    code: "generate_committee_packet",
    label: "Generate Committee Packet",
    description: "Committee review packet must be generated.",
    priority: "high",
    source: "canonical",
  },
  resolve_critical_flags: {
    code: "resolve_critical_flags",
    label: "Resolve Critical Flags",
    description: "Critical flags must be resolved before committee review.",
    priority: "critical",
    source: "canonical",
  },
  record_committee_decision: {
    code: "record_committee_decision",
    label: "Record Committee Decision",
    description: "Credit committee decision must be recorded.",
    priority: "critical",
    source: "canonical",
  },
  complete_attestation: {
    code: "complete_attestation",
    label: "Complete Attestation",
    description: "Required attestation must be completed after committee decision.",
    priority: "critical",
    source: "canonical",
  },
  submit_loan_request: {
    code: "submit_loan_request",
    label: "Submit Loan Request",
    description: "A loan request must be submitted before underwriting.",
    priority: "high",
    source: "canonical",
  },
  start_underwriting: {
    code: "start_underwriting",
    label: "Start Underwriting",
    description: "Documents are complete — underwriting can now begin.",
    priority: "high",
    source: "canonical",
  },
  review_credit_memo: {
    code: "review_credit_memo",
    label: "Review Credit Memo",
    description: "Credit memo should be reviewed before committee submission.",
    priority: "high",
    source: "canonical",
  },
  start_closing: {
    code: "start_closing",
    label: "Start Closing",
    description: "Committee has decided — closing process can begin.",
    priority: "high",
    source: "canonical",
  },
  complete_closing: {
    code: "complete_closing",
    label: "Complete Closing",
    description: "Closing is in progress and needs to be finalized.",
    priority: "high",
    source: "canonical",
  },
  no_action_required: {
    code: "no_action_required",
    label: "No Immediate Action Required",
    description: "There is no immediate action required at this time.",
    priority: "normal",
    source: "canonical",
  },
};
