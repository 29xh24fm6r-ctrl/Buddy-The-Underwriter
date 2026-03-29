// Pure function. No DB. No side effects. No network.
import type { SLACheckInput, SLACheckResult } from "./types";
import { WATCHLIST_REVIEW_CADENCE, WORKOUT_MILESTONE_CADENCE } from "./types";

const STALLED_THRESHOLD_DAYS = 14;

/**
 * Check SLA compliance for a watchlist or workout case.
 * Returns flags for review overdue, milestone overdue, and stalled status.
 */
export function checkDistressSLA(input: SLACheckInput): SLACheckResult {
  const now = new Date(input.nowIso).getTime();

  // Review cadence check
  let reviewOverdue = false;
  let nextReviewDueAt: string | null = null;

  if (input.caseType === "watchlist") {
    const cadence = WATCHLIST_REVIEW_CADENCE.find((c) => c.severity === input.severity);
    if (cadence && input.lastReviewAt) {
      const lastReview = new Date(input.lastReviewAt).getTime();
      const dueAt = lastReview + cadence.reviewIntervalDays * 24 * 60 * 60 * 1000;
      nextReviewDueAt = new Date(dueAt).toISOString();
      reviewOverdue = now > dueAt;
    }
  }

  // Milestone check for workout
  let milestoneOverdue = false;
  if (input.caseType === "workout" && input.nextMilestoneDueAt) {
    const dueAt = new Date(input.nextMilestoneDueAt).getTime();
    milestoneOverdue = now > dueAt;
  }

  // Stalled check
  let stalledDays = 0;
  let stalled = false;
  if (input.lastMaterialActivityAt) {
    const lastActivity = new Date(input.lastMaterialActivityAt).getTime();
    stalledDays = Math.floor((now - lastActivity) / (24 * 60 * 60 * 1000));
    stalled = stalledDays >= STALLED_THRESHOLD_DAYS;
  }

  return {
    reviewOverdue,
    milestoneOverdue,
    stalled,
    stalledDays,
    nextReviewDueAt,
  };
}
