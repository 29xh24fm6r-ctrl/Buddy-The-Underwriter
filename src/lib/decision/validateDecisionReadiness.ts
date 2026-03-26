/**
 * Decision readiness validation.
 * Ensures freeze, memo, and exception alignment before committee decision.
 * Pure module — no DB, no server-only.
 */

import type { CreditMemoCompleteness } from "@/lib/creditMemo/computeCreditMemoCompleteness";

export type DecisionReadiness = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
};

export type DecisionReadinessInput = {
  hasActiveFreeze: boolean;
  hasActiveMemoSnapshot: boolean;
  memoAlignedToFreeze: boolean;
  memoCompleteness: CreditMemoCompleteness;
  decisionType: string;
  activeExceptionCount: number;
  mitigatedExceptionCount: number;
  hasDecisionNotes: boolean;
  // Phase 55D: Financial validation integration
  financialValidationDecisionSafe?: boolean;
  financialValidationMemoSafe?: boolean;
  financialValidationSummaryStale?: boolean;
  financialValidationOpenCriticalCount?: number;
  // Phase 55E: Exception intelligence integration
  financialExceptionHighCount?: number;
  financialExceptionCriticalCount?: number;
  financialOverrideDisclosureRequired?: boolean;
  financialMaterialChangeAfterMemo?: boolean;
  // Phase 55F: Credit actioning integration
  openRequiredActionCount?: number;
  unresolvedPricingReview?: boolean;
  unresolvedStructureReview?: boolean;
  committeeDiscussionItemsOpen?: number;
};

/**
 * Validate whether a committee decision can be recorded.
 */
export function validateDecisionReadiness(
  input: DecisionReadinessInput,
): DecisionReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Must have active freeze
  if (!input.hasActiveFreeze) {
    blockers.push("Structure must be frozen before recording a decision");
  }

  // Must have active memo snapshot
  if (!input.hasActiveMemoSnapshot) {
    blockers.push("Credit memo must be generated before recording a decision");
  }

  // Memo must be aligned to current freeze
  if (input.hasActiveMemoSnapshot && !input.memoAlignedToFreeze) {
    blockers.push("Credit memo is stale relative to current freeze — regenerate memo");
  }

  // Phase 55D: Financial validation must be decision-safe
  if (input.financialValidationDecisionSafe === false) {
    blockers.push("Financial validation is not decision-safe — resolve open financial validation items");
  }
  if (input.financialValidationSummaryStale === true) {
    blockers.push("Financial validation summary is stale relative to latest evidence — regenerate memo");
  }
  if (input.financialValidationOpenCriticalCount != null && input.financialValidationOpenCriticalCount > 0) {
    blockers.push(`${input.financialValidationOpenCriticalCount} open critical financial validation item(s) remain`);
  }

  // Phase 55E: Exception intelligence blockers
  if (input.financialMaterialChangeAfterMemo === true) {
    blockers.push("Material financial change occurred after memo generation — regenerate memo");
  }
  if (input.financialExceptionCriticalCount != null && input.financialExceptionCriticalCount > 0) {
    blockers.push(`${input.financialExceptionCriticalCount} critical financial exception(s) remain open`);
  }
  if (input.financialOverrideDisclosureRequired === true) {
    warnings.push("Committee disclosure required for material banker override(s)");
  }
  if (input.financialExceptionHighCount != null && input.financialExceptionHighCount > 0) {
    warnings.push(`${input.financialExceptionHighCount} high-severity financial exception(s) should be reviewed before committee`);
  }

  // Phase 55F: Credit actioning blockers
  if (input.unresolvedPricingReview === true) {
    blockers.push("Pricing review recommended but not completed");
  }
  if (input.unresolvedStructureReview === true) {
    blockers.push("Structure review recommended but not completed");
  }
  if (input.openRequiredActionCount != null && input.openRequiredActionCount > 0) {
    blockers.push(`${input.openRequiredActionCount} required credit action(s) remain unaccepted`);
  }
  if (input.committeeDiscussionItemsOpen != null && input.committeeDiscussionItemsOpen > 0) {
    warnings.push(`${input.committeeDiscussionItemsOpen} committee discussion item(s) remain unresolved`);
  }

  // Memo must meet completeness threshold
  if (!input.memoCompleteness.complete) {
    blockers.push(`Credit memo incomplete (${input.memoCompleteness.pct}%) — missing: ${input.memoCompleteness.missing_sections.join(", ")}`);
  }

  // Decision-type-specific checks
  if (input.decisionType === "approved_with_exceptions") {
    if (input.activeExceptionCount === 0) {
      warnings.push("Approved-with-exceptions selected but no active exceptions exist");
    }
    if (input.activeExceptionCount > 0 && input.mitigatedExceptionCount === 0) {
      blockers.push("Active exceptions exist but none have documented mitigants");
    }
  }

  if (input.decisionType === "approved_with_changes") {
    if (!input.hasDecisionNotes) {
      blockers.push("Approved-with-changes requires decision notes describing the changes");
    }
  }

  if (input.decisionType === "declined") {
    if (!input.hasDecisionNotes) {
      blockers.push("Decline decision requires notes explaining the rationale");
    }
  }

  // Memo completeness warnings
  for (const w of input.memoCompleteness.warnings) {
    warnings.push(w);
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
  };
}
