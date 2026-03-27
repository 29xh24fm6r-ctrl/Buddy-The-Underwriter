/**
 * Buddy Explanation Engine — Phase 65C
 *
 * Deterministic explanation of deal state.
 * Buddy explains state. Omega explains reasoning.
 * These two NEVER mix in this module.
 */

import type { BuddyCanonicalState } from "@/core/state/types";
import type { BuddyExplanation } from "./types";
import { deriveStateReasons } from "./deriveStateReasons";
import { deriveBlockingFactors } from "./deriveBlockingFactors";

function buildSummary(state: BuddyCanonicalState): string {
  const stage = state.lifecycle.replace(/_/g, " ");
  const blockerCount = state.blockers.length;
  const nextLabel = state.nextRequiredAction.label;

  if (blockerCount > 0) {
    return `This deal is in ${stage} with ${blockerCount} blocking issue${blockerCount > 1 ? "s" : ""}. Next action: ${nextLabel}.`;
  }

  return `This deal is in ${stage}. Next action: ${nextLabel}.`;
}

function buildSupportingFacts(state: BuddyCanonicalState): string[] {
  const facts: string[] = [];

  if (state.checklistReadiness.totalItems > 0) {
    facts.push(
      `Checklist: ${state.checklistReadiness.satisfiedItems}/${state.checklistReadiness.totalItems} items satisfied`,
    );
  }

  if (state.pricingState.pricingQuoteReady) {
    facts.push("Pricing quote is committed");
  }

  if (state.pricingState.riskPricingFinalized) {
    facts.push("Risk pricing is finalized");
  }

  if (state.committeeState.required) {
    facts.push(
      state.committeeState.complete
        ? `Committee decision: ${state.committeeState.outcome}`
        : `Committee: ${state.committeeState.voteCount}/${state.committeeState.quorum} votes`,
    );
  }

  if (state.exceptionState.openCount > 0) {
    facts.push(
      `${state.exceptionState.openCount} open exception${state.exceptionState.openCount > 1 ? "s" : ""}${state.exceptionState.criticalCount > 0 ? ` (${state.exceptionState.criticalCount} critical)` : ""}`,
    );
  }

  return facts;
}

/**
 * Derive a complete deterministic explanation of deal state.
 * No Omega input. Pure function of BuddyCanonicalState.
 */
export function deriveBuddyExplanation(
  state: BuddyCanonicalState,
): BuddyExplanation {
  return {
    summary: buildSummary(state),
    reasons: deriveStateReasons(state),
    blockingFactors: deriveBlockingFactors(state),
    supportingFacts: buildSupportingFacts(state),
  };
}
