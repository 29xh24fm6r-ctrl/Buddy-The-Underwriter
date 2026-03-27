/**
 * State Reasons — Phase 65C
 *
 * Deterministic derivation of WHY a deal is in its current state.
 * Uses only BuddyCanonicalState. No Omega input.
 */

import type { BuddyCanonicalState } from "@/core/state/types";

export function deriveStateReasons(state: BuddyCanonicalState): string[] {
  const reasons: string[] = [];
  const s = state.lifecycle;

  if (s === "intake_created") {
    reasons.push("Deal was recently created and intake has not started");
  }

  if (s === "docs_requested") {
    reasons.push("Documents have been requested from the borrower");
  }

  if (s === "docs_in_progress") {
    reasons.push("Borrower documents are being collected and reviewed");
    if (!state.checklistReadiness.ready) {
      reasons.push(`Document readiness is incomplete (${state.checklistReadiness.satisfiedItems} of ${state.checklistReadiness.totalItems} items satisfied)`);
    }
  }

  if (s === "docs_satisfied") {
    reasons.push("All required documents have been received");
    if (!state.pricingState.hasPricingAssumptions) {
      reasons.push("Pricing assumptions have not been set yet");
    }
  }

  if (s === "underwrite_ready") {
    reasons.push("Documents are complete and deal is ready for underwriting");
  }

  if (s === "underwrite_in_progress") {
    reasons.push("Underwriting analysis is in progress");
    if (!state.pricingState.riskPricingFinalized) {
      reasons.push("Risk-based pricing has not been finalized");
    }
    if (!state.pricingState.structuralPricingReady) {
      reasons.push("Structural pricing is not yet complete");
    }
  }

  if (s === "committee_ready") {
    reasons.push("Deal is ready for credit committee review");
    if (!state.pricingState.pricingQuoteReady) {
      reasons.push("Pricing quote has not been committed");
    }
    if (state.exceptionState.hasEscalated) {
      reasons.push("One or more exceptions were escalated to committee");
    }
  }

  if (s === "committee_decisioned") {
    reasons.push("Credit committee has made a decision on this deal");
  }

  if (s === "closing_in_progress") {
    reasons.push("Deal is in the closing process");
  }

  if (s === "closed") {
    reasons.push("Deal has been closed");
  }

  if (s === "workout") {
    reasons.push("Deal has entered workout/troubled asset management");
  }

  return reasons;
}
