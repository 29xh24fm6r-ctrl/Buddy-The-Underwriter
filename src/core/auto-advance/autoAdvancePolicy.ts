/**
 * Phase 65G — Auto-Advance Policy
 *
 * Deterministic eligibility rules for stage advancement.
 * Uses actual canonical stage names from the lifecycle model.
 *
 * Pure function — no DB, no side effects.
 */

import type { AutoAdvanceTriggerCode } from "@/core/sla/types";

export type AutoAdvanceRule = {
  fromStage: string;
  toStage: string;
  triggerCode: AutoAdvanceTriggerCode;
  /** Blocker codes that MUST be absent for eligibility */
  requiredAbsentBlockers: string[];
  /** Description for audit */
  description: string;
};

export const AUTO_ADVANCE_RULES: AutoAdvanceRule[] = [
  {
    fromStage: "docs_in_progress",
    toStage: "docs_satisfied",
    triggerCode: "borrower_campaigns_complete",
    requiredAbsentBlockers: [
      "gatekeeper_docs_incomplete",
      "gatekeeper_docs_need_review",
    ],
    description:
      "All borrower campaigns complete and no document readiness blockers remain.",
  },
  {
    fromStage: "docs_satisfied",
    toStage: "underwrite_ready",
    triggerCode: "readiness_blockers_cleared",
    requiredAbsentBlockers: [
      "pricing_assumptions_required",
      "loan_request_missing",
      "loan_request_incomplete",
      "gatekeeper_docs_incomplete",
      "gatekeeper_docs_need_review",
    ],
    description:
      "All readiness blockers cleared including pricing assumptions and loan request.",
  },
  {
    fromStage: "underwrite_ready",
    toStage: "underwrite_in_progress",
    triggerCode: "underwriting_ready",
    requiredAbsentBlockers: [
      "financial_snapshot_missing",
    ],
    description:
      "Financial snapshot exists and underwriting can begin.",
  },
  {
    fromStage: "underwrite_in_progress",
    toStage: "committee_ready",
    triggerCode: "memo_ready_for_review",
    requiredAbsentBlockers: [
      "risk_pricing_not_finalized",
      "structural_pricing_missing",
      "critical_flags_unresolved",
      "pricing_quote_missing",
    ],
    description:
      "All underwriting blockers cleared, ready for committee review.",
  },
  {
    fromStage: "committee_decisioned",
    toStage: "closing_in_progress",
    triggerCode: "closing_requirements_complete",
    requiredAbsentBlockers: [
      "attestation_missing",
    ],
    description:
      "Committee decision made and attestation requirements satisfied.",
  },
];

/**
 * Find the applicable auto-advance rule for a given stage.
 */
export function getAutoAdvanceRule(
  currentStage: string,
): AutoAdvanceRule | null {
  return AUTO_ADVANCE_RULES.find((r) => r.fromStage === currentStage) ?? null;
}
