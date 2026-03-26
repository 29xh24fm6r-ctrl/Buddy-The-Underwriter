/**
 * Phase 54C — Banker Review Queue Insights
 *
 * Pure function that tells bankers what needs review, what's stale,
 * and where borrower/bank wait state diverges.
 */

import type { EvidenceReviewState } from "./evidence-review-types";

type ReviewQueueItem = {
  id: string;
  conditionId: string;
  conditionTitle?: string;
  reviewState: EvidenceReviewState;
  createdAt: string;
  reviewedAt: string | null;
  sourceOfFlag: string;
};

export type ReviewQueueInsights = {
  queueCounts: Record<EvidenceReviewState, number>;
  totalPending: number;
  staleItems: Array<{ reviewId: string; conditionId: string; staleDays: number }>;
  conditionsWithRepeatedAmbiguity: string[];
  borrowerWaitingOnBank: boolean;
  borrowerHasActionableItems: boolean;
  topUnresolvedBlockers: Array<{ reviewId: string; conditionTitle: string; reason: string }>;
};

const STALE_THRESHOLD_DAYS = 3;

/**
 * Derive review queue insights for banker visibility.
 * Pure function — no DB calls.
 */
export function deriveReviewQueueInsights(
  items: ReviewQueueItem[],
  borrowerHasActionableConditions: boolean,
): ReviewQueueInsights {
  const counts: Record<EvidenceReviewState, number> = {
    queued_for_review: 0,
    in_review: 0,
    accepted: 0,
    partially_accepted: 0,
    rejected: 0,
    clarification_requested: 0,
    waived: 0,
  };

  const staleItems: ReviewQueueInsights["staleItems"] = [];
  const conditionAmbiguityCount = new Map<string, number>();

  for (const item of items) {
    counts[item.reviewState] = (counts[item.reviewState] ?? 0) + 1;

    // Stale detection
    if (item.reviewState === "queued_for_review" || item.reviewState === "in_review") {
      const ageDays = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 86400000);
      if (ageDays >= STALE_THRESHOLD_DAYS) {
        staleItems.push({ reviewId: item.id, conditionId: item.conditionId, staleDays: ageDays });
      }
    }

    // Repeated ambiguity detection
    if (item.sourceOfFlag === "auto_ambiguity") {
      conditionAmbiguityCount.set(
        item.conditionId,
        (conditionAmbiguityCount.get(item.conditionId) ?? 0) + 1,
      );
    }
  }

  const pendingStates = new Set<EvidenceReviewState>(["queued_for_review", "in_review"]);
  const totalPending = items.filter((i) => pendingStates.has(i.reviewState)).length;

  const borrowerWaitingOnBank = totalPending > 0 && !borrowerHasActionableConditions;

  const conditionsWithRepeatedAmbiguity = [...conditionAmbiguityCount.entries()]
    .filter(([, count]) => count >= 2)
    .map(([condId]) => condId);

  const topUnresolvedBlockers = items
    .filter((i) => pendingStates.has(i.reviewState))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, 5)
    .map((i) => ({
      reviewId: i.id,
      conditionTitle: i.conditionTitle ?? "Condition",
      reason: i.sourceOfFlag === "auto_ambiguity" ? "Ambiguous evidence" : "Needs banker review",
    }));

  return {
    queueCounts: counts,
    totalPending,
    staleItems: staleItems.sort((a, b) => b.staleDays - a.staleDays),
    conditionsWithRepeatedAmbiguity,
    borrowerWaitingOnBank,
    borrowerHasActionableItems: borrowerHasActionableConditions,
    topUnresolvedBlockers,
  };
}
