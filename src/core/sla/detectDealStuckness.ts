/**
 * Phase 65G — Stuckness Detection
 *
 * Converts aging evidence into explicit stuck reason codes.
 * Pure function — no DB, no side effects.
 */

import type { StuckReasonCode, DealUrgencyBucket } from "./types";
import { getStageSla, OBJECT_SLA_POLICY } from "./slaPolicy";

export type StucknessInput = {
  canonicalStage: string;
  stageAgeHours: number;
  primaryActionCode: string | null;
  primaryActionPriority: string | null;
  primaryActionAgeHours: number | null;
  borrowerCampaignsOpen: number;
  borrowerCampaignsOverdue: number;
  criticalItemsOverdue: number;
  bankerTasksStale: number;
  uploadsWaitingReview: number;
  hasUnresolvedMemoBlockers: boolean;
  hasUnresolvedPricingBlockers: boolean;
  isClosingStage: boolean;
  isBorrowerBlocking: boolean;
};

export type DetectDealStucknessResult = {
  isDealStuck: boolean;
  stuckReasonCodes: StuckReasonCode[];
};

export function detectDealStuckness(
  input: StucknessInput,
): DetectDealStucknessResult {
  const reasons: StuckReasonCode[] = [];
  const stageSla = getStageSla(input.canonicalStage);

  // Stage overdue
  if (input.stageAgeHours >= stageSla.urgentHours) {
    reasons.push("stage_overdue");
  }

  // Primary action stale
  if (input.primaryActionAgeHours !== null && input.primaryActionCode) {
    const threshold = getActionStaleThreshold(input.primaryActionPriority);
    if (input.primaryActionAgeHours >= threshold) {
      reasons.push("primary_action_stale");
    }
  }

  // Borrower unresponsive
  if (input.borrowerCampaignsOverdue > 0 && input.criticalItemsOverdue > 0) {
    reasons.push("borrower_unresponsive");
  }

  // Borrower opened but not submitted (partial progress stall)
  if (
    input.borrowerCampaignsOpen > 0 &&
    input.uploadsWaitingReview > 0 &&
    input.criticalItemsOverdue > 0
  ) {
    reasons.push("borrower_opened_not_submitted");
  }

  // Uploads waiting for review
  if (input.uploadsWaitingReview > 0 && input.bankerTasksStale > 0) {
    reasons.push("uploads_waiting_for_review");
  }

  // Memo gap aging
  if (input.hasUnresolvedMemoBlockers && input.stageAgeHours >= OBJECT_SLA_POLICY.memoGap.watchHours) {
    reasons.push("memo_gap_aging");
  }

  // Pricing waiting on assumptions
  if (input.hasUnresolvedPricingBlockers && input.stageAgeHours >= OBJECT_SLA_POLICY.memoGap.watchHours) {
    reasons.push("pricing_waiting_on_assumptions");
  }

  // Closing stalled
  if (input.isClosingStage && input.stageAgeHours >= stageSla.urgentHours) {
    reasons.push("closing_stalled");
  }

  // Banker inactive on critical action
  if (
    input.primaryActionPriority === "critical" &&
    input.primaryActionAgeHours !== null &&
    input.primaryActionAgeHours >= OBJECT_SLA_POLICY.primaryAction.criticalActionStaleHours &&
    !input.isBorrowerBlocking
  ) {
    reasons.push("banker_inactive_on_critical_action");
  }

  return {
    isDealStuck: reasons.length > 0,
    stuckReasonCodes: reasons,
  };
}

function getActionStaleThreshold(priority: string | null): number {
  switch (priority) {
    case "critical":
      return OBJECT_SLA_POLICY.primaryAction.criticalActionStaleHours;
    case "high":
      return OBJECT_SLA_POLICY.primaryAction.highActionStaleHours;
    default:
      return OBJECT_SLA_POLICY.primaryAction.normalActionStaleHours;
  }
}
