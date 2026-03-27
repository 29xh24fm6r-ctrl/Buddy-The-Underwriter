/**
 * Blocking Factors — Phase 65C
 *
 * Human-readable descriptions of what is blocking deal progress.
 * Derived from BuddyCanonicalState blockers. No Omega input.
 */

import type { BuddyCanonicalState } from "@/core/state/types";

const BLOCKER_DESCRIPTIONS: Record<string, string> = {
  checklist_not_seeded: "Deal checklist has not been initialized",
  gatekeeper_docs_incomplete: "Required documents are still missing",
  gatekeeper_docs_need_review: "Documents require AI review before proceeding",
  pricing_assumptions_required: "Pricing assumptions must be set before underwriting",
  financial_snapshot_missing: "Financial snapshot has not been generated",
  risk_pricing_not_finalized: "Risk-based pricing analysis is not finalized",
  structural_pricing_missing: "Structural pricing terms are not complete",
  critical_flags_unresolved: "Critical flags must be resolved before committee",
  committee_packet_missing: "Committee review packet has not been generated",
  decision_missing: "Credit committee decision has not been recorded",
  attestation_missing: "Required attestation has not been completed",
  pricing_quote_missing: "Pricing quote must be committed before committee",
  financial_snapshot_stale: "Financial snapshot is outdated and needs regeneration",
  financial_validation_open: "Financial validation issues are unresolved",
  financial_snapshot_build_failed: "Financial snapshot generation failed",
  identity_not_verified: "Borrower identity has not been verified",
  intake_health_below_threshold: "Intake health score is below required threshold",
};

export function deriveBlockingFactors(state: BuddyCanonicalState): string[] {
  return state.blockers.map((b) => {
    return BLOCKER_DESCRIPTIONS[b.code] ?? b.message ?? b.code.replace(/_/g, " ");
  });
}
