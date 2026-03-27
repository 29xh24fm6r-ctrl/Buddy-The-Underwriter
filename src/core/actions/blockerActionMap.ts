/**
 * Blocker → Action Map — Phase 65D
 *
 * Maps canonical LifecycleBlockerCode values to action codes.
 * Uses REAL blocker codes from src/buddy/lifecycle/model.ts.
 * Unmapped blockers fall back to resolve_readiness_blockers.
 */

import type { BuddyActionCode } from "./types";

export const BLOCKER_ACTION_MAP: Record<string, BuddyActionCode[]> = {
  // Business logic blockers
  checklist_not_seeded: ["seed_checklist"],
  gatekeeper_docs_incomplete: ["request_documents"],
  gatekeeper_docs_need_review: ["finalize_document_classification"],
  pricing_assumptions_required: ["set_pricing_assumptions"],
  financial_snapshot_missing: ["generate_financial_snapshot"],
  risk_pricing_not_finalized: ["finalize_risk_pricing"],
  structural_pricing_missing: ["complete_structural_pricing"],
  pricing_quote_missing: ["commit_pricing_quote"],
  committee_packet_missing: ["generate_committee_packet"],
  critical_flags_unresolved: ["resolve_critical_flags"],
  decision_missing: ["record_committee_decision"],
  attestation_missing: ["complete_attestation"],
  loan_request_missing: ["submit_loan_request"],
  loan_request_incomplete: ["submit_loan_request"],
  spreads_incomplete: ["run_extraction"],
  identity_not_verified: ["resolve_readiness_blockers"],
  policy_exceptions_unresolved: ["resolve_readiness_blockers"],
  closing_docs_missing: ["request_documents"],

  // Financial validation blockers
  financial_snapshot_stale: ["generate_financial_snapshot"],
  financial_validation_open: ["resolve_readiness_blockers"],
  financial_snapshot_build_failed: ["generate_financial_snapshot"],

  // Intake blockers
  intake_health_below_threshold: ["resolve_readiness_blockers"],
  intake_confirmation_required: ["resolve_readiness_blockers"],
};
