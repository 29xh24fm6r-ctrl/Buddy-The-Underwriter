/**
 * Phase 65I — Monitoring Blocking Party Derivation
 *
 * Mirrors 65H logic so post-close items surface naturally in the command center.
 * Pure function — no DB, no side effects.
 */

import type { MonitoringBlockingParty, MonitoringCycleStatus } from "./types";

export type MonitoringBlockingInput = {
  cycleStatus: MonitoringCycleStatus;
  requiresBorrowerSubmission: boolean;
  requiresBankerReview: boolean;
  submissionReceived: boolean;
  reviewStarted: boolean;
};

export function deriveMonitoringBlockingParty(
  input: MonitoringBlockingInput,
): MonitoringBlockingParty {
  // Completed, waived, upcoming — nobody blocking
  if (["completed", "waived", "upcoming"].includes(input.cycleStatus)) {
    return "unknown";
  }

  const borrowerOwes =
    input.requiresBorrowerSubmission && !input.submissionReceived;

  const bankerOwes =
    input.submissionReceived &&
    input.requiresBankerReview &&
    !input.reviewStarted;

  if (borrowerOwes && bankerOwes) return "mixed";
  if (borrowerOwes) return "borrower";
  if (bankerOwes) return "banker";

  // Submitted + under review = banker
  if (input.cycleStatus === "under_review") return "banker";
  if (input.cycleStatus === "submitted") return "banker";

  return "unknown";
}
