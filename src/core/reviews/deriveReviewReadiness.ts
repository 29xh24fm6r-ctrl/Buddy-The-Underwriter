/**
 * Phase 65J — Derive Review Readiness
 *
 * The heart of 65J. Deterministic and explainable.
 * Pure function — no DB, no side effects.
 */

import type { ReviewReadinessState, ReviewRequirementStatus } from "./types";

export type ReadinessInput = {
  requirements: Array<{
    required: boolean;
    status: ReviewRequirementStatus;
    borrowerVisible: boolean;
  }>;
  openExceptionCount: number;
};

export function deriveReviewReadiness(input: ReadinessInput): ReviewReadinessState {
  const required = input.requirements.filter((r) => r.required);

  if (required.length === 0 && input.openExceptionCount === 0) {
    return "ready";
  }

  // Check for open exceptions
  if (input.openExceptionCount > 0) {
    return "exception_open";
  }

  // Check for pending/requested borrower items
  const pendingBorrower = required.filter(
    (r) =>
      r.borrowerVisible &&
      (r.status === "pending" || r.status === "requested"),
  );
  if (pendingBorrower.length > 0) {
    return "missing_borrower_items";
  }

  // Check for submitted but unreviewed banker items
  const unreviewed = required.filter(
    (r) => r.status === "submitted" || r.status === "under_review",
  );
  if (unreviewed.length > 0) {
    return "missing_banker_review";
  }

  // Check all required are completed/waived
  const allDone = required.every(
    (r) => r.status === "completed" || r.status === "waived",
  );

  if (allDone) {
    return "ready";
  }

  // Fallback: something is still pending
  return "not_started";
}
