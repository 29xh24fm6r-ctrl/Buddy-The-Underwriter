/**
 * Phase 65G — Urgency Derivation
 *
 * Deterministic scoring → urgency bucket.
 * Pure function — no DB, no side effects.
 */

import type { DealUrgencyBucket, StuckReasonCode } from "./types";

export type UrgencyInput = {
  isStageOverdue: boolean;
  isPrimaryActionStale: boolean;
  borrowerCampaignsOverdue: number;
  criticalItemsOverdue: number;
  uploadsWaitingReview: number;
  bankerTasksStale: number;
  activeEscalationCount: number;
  stuckReasonCodes: StuckReasonCode[];
};

export type UrgencyResult = {
  urgencyScore: number;
  urgencyBucket: DealUrgencyBucket;
};

const SCORE_WEIGHTS: Record<string, number> = {
  stage_overdue: 40,
  critical_item_overdue: 25,
  primary_action_stale: 20,
  borrower_campaign_overdue: 15,
  uploads_waiting_review: 15,
  active_escalation: 30,
  banker_tasks_stale: 10,
};

export function deriveDealUrgency(input: UrgencyInput): UrgencyResult {
  let score = 0;

  if (input.isStageOverdue) score += SCORE_WEIGHTS.stage_overdue;
  if (input.isPrimaryActionStale) score += SCORE_WEIGHTS.primary_action_stale;
  if (input.criticalItemsOverdue > 0) score += SCORE_WEIGHTS.critical_item_overdue;
  if (input.borrowerCampaignsOverdue > 0) score += SCORE_WEIGHTS.borrower_campaign_overdue;
  if (input.uploadsWaitingReview > 0) score += SCORE_WEIGHTS.uploads_waiting_review;
  if (input.activeEscalationCount > 0) score += SCORE_WEIGHTS.active_escalation;
  if (input.bankerTasksStale > 0) score += SCORE_WEIGHTS.banker_tasks_stale;

  return {
    urgencyScore: score,
    urgencyBucket: scoreToBucket(score),
  };
}

function scoreToBucket(score: number): DealUrgencyBucket {
  if (score >= 70) return "critical";
  if (score >= 40) return "urgent";
  if (score >= 20) return "watch";
  return "healthy";
}
