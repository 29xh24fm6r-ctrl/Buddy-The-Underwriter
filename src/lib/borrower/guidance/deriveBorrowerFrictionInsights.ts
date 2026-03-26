/**
 * Phase 54B — Banker Friction Insights
 *
 * Tells bankers where borrowers are stuck, confused, or waiting.
 * Pure function — no DB calls.
 */

import type { CanonicalConditionStatus } from "@/lib/conditions/deriveConditionStatus";
import type { BorrowerFrictionInsights, ReadinessLabel } from "./types";

type FrictionCondition = {
  id: string;
  title: string;
  status: CanonicalConditionStatus;
  severity: string | null;
  linkedDocCount: number;
  stalledDays: number;
  rejectedCount: number;
};

type FrictionInput = {
  conditions: FrictionCondition[];
  readinessScore: number;
  readinessLabel: ReadinessLabel;
  primaryNextAction: string | null;
};

/**
 * Derive borrower friction insights for banker visibility.
 */
export function deriveBorrowerFrictionInsights(input: FrictionInput): BorrowerFrictionInsights {
  const { conditions, readinessScore, readinessLabel, primaryNextAction } = input;

  const actionable = new Set<CanonicalConditionStatus>(["pending", "rejected", "partially_satisfied"]);
  const review = new Set<CanonicalConditionStatus>(["submitted", "under_review"]);

  const hasActionableItems = conditions.some((c) => actionable.has(c.status));
  const waitingOnBank = conditions.some((c) => review.has(c.status)) && !hasActionableItems;

  // Friction conditions: stalled > 3 days OR rejected OR repeatedly partial
  const frictionConditions = conditions
    .filter((c) => c.stalledDays > 3 || c.status === "rejected" || (c.status === "partially_satisfied" && c.linkedDocCount >= 2))
    .sort((a, b) => b.stalledDays - a.stalledDays)
    .slice(0, 5)
    .map((c) => ({
      conditionId: c.id,
      title: c.title,
      reason: buildFrictionReason(c),
      stalledDays: c.stalledDays,
    }));

  const repeatedRejections = conditions.reduce((sum, c) => sum + c.rejectedCount, 0);

  // Likely confused: has actionable items + stalled > 5 days + low readiness
  const likelyConfused = hasActionableItems &&
    conditions.some((c) => c.stalledDays > 5 && actionable.has(c.status)) &&
    readinessScore < 50;

  return {
    topFrictionConditions: frictionConditions,
    repeatedRejectionCount: repeatedRejections,
    borrowerHasActionableItems: hasActionableItems,
    waitingOnBankReview: waitingOnBank,
    likelyConfusedBorrower: likelyConfused,
    currentBorrowerNextAction: primaryNextAction,
    readinessLabel,
    readinessScore,
  };
}

function buildFrictionReason(c: FrictionCondition): string {
  if (c.status === "rejected") return "Submission rejected — borrower needs to re-upload";
  if (c.status === "partially_satisfied" && c.linkedDocCount >= 2) return "Multiple uploads but still not complete";
  if (c.stalledDays > 7) return `Stalled for ${c.stalledDays} days with no activity`;
  if (c.stalledDays > 3) return `No activity for ${c.stalledDays} days`;
  return "May need borrower attention";
}
