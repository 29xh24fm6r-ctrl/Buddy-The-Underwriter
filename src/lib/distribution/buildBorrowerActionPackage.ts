/**
 * Phase 54C — Borrower Action Package Builder
 *
 * Produces a coherent borrower-facing package that aligns with live
 * condition/guidance/review state. No contradictions between portal,
 * package, and outbound messages.
 *
 * Pure function — no DB calls.
 */

import type { BorrowerGuidancePayload } from "@/lib/borrower/guidance/types";
import type { EvidenceReviewState } from "@/lib/review/evidence-review-types";

type ReviewSummaryItem = {
  conditionId: string;
  conditionTitle: string;
  reviewState: EvidenceReviewState;
  explanationBorrowerSafe: string | null;
  requestedClarification: string | null;
};

export type BorrowerActionPackage = {
  statusSummary: string;
  readinessLabel: string;
  readinessScore: number;
  prioritizedNextActions: Array<{
    title: string;
    description: string;
    priority: string;
    ctaLabel: string;
  }>;
  outstandingRequiredItems: Array<{
    conditionId: string;
    title: string;
    status: string;
    explanation: string;
  }>;
  clarificationRequests: Array<{
    conditionId: string;
    title: string;
    clarification: string;
  }>;
  reviewOutcomes: Array<{
    conditionId: string;
    title: string;
    outcome: string;
    explanation: string;
  }>;
  completedItems: number;
  totalItems: number;
  generatedAt: string;
};

/**
 * Build a borrower action package from live guidance + review state.
 * Ensures no contradiction between portal, package, and outbound messages.
 */
export function buildBorrowerActionPackage(
  guidance: BorrowerGuidancePayload,
  reviewItems: ReviewSummaryItem[],
): BorrowerActionPackage {
  const { readiness, primaryNextAction, secondaryActions, conditionGuidance } = guidance;

  // Status summary
  const statusSummary = readiness.score >= 95
    ? "Your file is complete and ready for underwriting review."
    : readiness.score >= 75
    ? `Almost there — ${readiness.criticalItemsRemaining} required item${readiness.criticalItemsRemaining !== 1 ? "s" : ""} remaining.`
    : readiness.score >= 50
    ? "Good progress. Keep uploading the remaining items to move forward."
    : "We need several items to move your application forward. Let's get started.";

  // Prioritized actions from guidance
  const actions = [
    ...(primaryNextAction ? [{
      title: primaryNextAction.title,
      description: primaryNextAction.description,
      priority: primaryNextAction.priority,
      ctaLabel: primaryNextAction.ctaLabel,
    }] : []),
    ...secondaryActions.map((a) => ({
      title: a.title,
      description: a.description,
      priority: a.priority,
      ctaLabel: a.ctaLabel,
    })),
  ];

  // Outstanding items from condition guidance
  const outstanding = conditionGuidance
    .filter((c) => c.canonicalStatus !== "satisfied" && c.canonicalStatus !== "waived")
    .map((c) => ({
      conditionId: c.conditionId,
      title: c.borrowerLabel,
      status: c.canonicalStatus,
      explanation: c.borrowerExplanation,
    }));

  // Clarification requests from review items
  const clarifications = reviewItems
    .filter((r) => r.reviewState === "clarification_requested" && r.requestedClarification)
    .map((r) => ({
      conditionId: r.conditionId,
      title: r.conditionTitle,
      clarification: r.requestedClarification!,
    }));

  // Review outcomes borrower should see
  const outcomes = reviewItems
    .filter((r) => r.reviewState === "rejected" || r.reviewState === "partially_accepted")
    .map((r) => ({
      conditionId: r.conditionId,
      title: r.conditionTitle,
      outcome: r.reviewState === "rejected" ? "Not accepted" : "Partially complete",
      explanation: r.explanationBorrowerSafe ?? "Please check the condition details for more information.",
    }));

  const completed = conditionGuidance.filter(
    (c) => c.canonicalStatus === "satisfied" || c.canonicalStatus === "waived",
  ).length;

  return {
    statusSummary,
    readinessLabel: readiness.label,
    readinessScore: readiness.score,
    prioritizedNextActions: actions,
    outstandingRequiredItems: outstanding,
    clarificationRequests: clarifications,
    reviewOutcomes: outcomes,
    completedItems: completed,
    totalItems: conditionGuidance.length,
    generatedAt: new Date().toISOString(),
  };
}
