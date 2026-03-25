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
