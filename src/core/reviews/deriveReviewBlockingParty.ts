/**
 * Phase 65J — Derive Review Blocking Party
 *
 * Pure function — no DB, no side effects.
 */

import type { ReviewBlockingParty, ReviewReadinessState } from "./types";

export type ReviewBlockingInput = {
  readinessState: ReviewReadinessState;
  hasOutputsInFlight: boolean;
};

export function deriveReviewBlockingParty(
  input: ReviewBlockingInput,
): ReviewBlockingParty {
  if (input.hasOutputsInFlight) return "buddy";

  switch (input.readinessState) {
    case "missing_borrower_items":
      return "borrower";
    case "missing_banker_review":
      return "banker";
    case "exception_open":
      return "banker";
    case "ready":
    case "not_started":
      return "unknown";
    default:
      return "unknown";
  }
}
