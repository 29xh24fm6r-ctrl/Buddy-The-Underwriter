/**
 * Phase 65H — Blocking Party Derivation
 *
 * Determines who is blocking deal progress.
 * Pure function — no DB, no side effects.
 */

import type { BlockingParty } from "./types";

export type BlockingPartyInput = {
  borrowerOverdueCount: number;
  borrowerRemindersExhausted: boolean;
  borrowerCampaignStatus: string | null;
  isPrimaryActionStale: boolean;
  primaryActionPriority: "critical" | "high" | "normal" | null;
  reviewBacklogCount: number;
  isQueueJobRunning: boolean;
};

export function deriveBlockingParty(input: BlockingPartyInput): BlockingParty {
  const borrowerBlocking =
    input.borrowerOverdueCount > 0 ||
    input.borrowerRemindersExhausted ||
    (input.borrowerCampaignStatus === "sent" || input.borrowerCampaignStatus === "in_progress");

  const bankerBlocking =
    (input.isPrimaryActionStale && input.primaryActionPriority !== null) ||
    input.reviewBacklogCount > 0;

  if (input.isQueueJobRunning && !borrowerBlocking && !bankerBlocking) {
    return "buddy";
  }

  if (borrowerBlocking && bankerBlocking) {
    return "mixed";
  }

  if (borrowerBlocking) {
    return "borrower";
  }

  if (bankerBlocking) {
    return "banker";
  }

  if (input.isQueueJobRunning) {
    return "buddy";
  }

  return "unknown";
}
