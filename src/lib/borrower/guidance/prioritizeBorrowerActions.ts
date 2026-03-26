/**
 * Phase 54B — Borrower Action Prioritizer
 *
 * Deterministic priority engine: one primary action, up to three secondary.
 * No ML, no scoring models — explicit, auditable priority rules.
 *
 * Pure function — no DB calls.
 */

import type { CanonicalConditionStatus } from "@/lib/conditions/deriveConditionStatus";
import type { BorrowerAction, ActionPriority } from "./types";

export type PrioritizableCondition = {
  id: string;
  title: string;
  status: CanonicalConditionStatus;
  severity: "REQUIRED" | "IMPORTANT" | "FYI" | string | null;
  dueDate: string | null;
  linkedDocCount: number;
  rejectionReason?: string | null;
  stalledDays?: number;
};

export type PrioritizedActions = {
  primary: BorrowerAction | null;
  secondary: BorrowerAction[];
  allBorrowerDone: boolean;
};

// Priority tiers — lower number = higher priority
const TIER_CRITICAL = 0;
const TIER_HIGH = 10;
const TIER_MEDIUM = 20;
const TIER_LOW = 30;

type ScoredCondition = PrioritizableCondition & { score: number };

/**
 * Prioritize borrower actions from conditions list.
 * Returns one primary + up to 3 secondary actions.
 */
export function prioritizeBorrowerActions(conditions: PrioritizableCondition[]): PrioritizedActions {
  const actionable = conditions.filter((c) =>
    c.status === "pending" || c.status === "rejected" || c.status === "partially_satisfied",
  );
  const underReview = conditions.filter((c) =>
    c.status === "submitted" || c.status === "under_review",
  );
  const terminal = conditions.filter((c) =>
    c.status === "satisfied" || c.status === "waived",
  );

  // If nothing actionable and nothing under review, borrower is done
  if (actionable.length === 0 && underReview.length === 0) {
    return { primary: null, secondary: [], allBorrowerDone: true };
  }

  // If nothing actionable but items under review, show wait state
  if (actionable.length === 0) {
    return {
      primary: {
        type: "wait_for_review",
        title: "Your file is being reviewed",
        description: `${underReview.length} item${underReview.length !== 1 ? "s are" : " is"} currently under review. No action needed right now.`,
        rationale: "All your submissions are being processed by the team.",
        linkedConditionId: null,
        priority: "low",
        estimatedMinutes: null,
        ctaLabel: "View Status",
        ctaTarget: null,
      },
      secondary: [],
      allBorrowerDone: false,
    };
  }

  // Score and sort actionable conditions
  const scored: ScoredCondition[] = actionable.map((c) => ({
    ...c,
    score: computePriorityScore(c),
  })).sort((a, b) => a.score - b.score);

  const primary = conditionToAction(scored[0]);
  const secondary = scored.slice(1, 4).map(conditionToAction);

  return { primary, secondary, allBorrowerDone: false };
}

function computePriorityScore(c: PrioritizableCondition): number {
  let score = 0;

  // Tier 1: Status-based priority
  if (c.status === "rejected") score += TIER_CRITICAL;
  else if (c.status === "pending" && c.severity === "REQUIRED") score += TIER_CRITICAL + 1;
  else if (c.status === "partially_satisfied" && c.severity === "REQUIRED") score += TIER_CRITICAL + 2;
  else if (c.status === "pending" && c.severity === "IMPORTANT") score += TIER_HIGH;
  else if (c.status === "partially_satisfied") score += TIER_HIGH + 1;
  else if (c.status === "pending") score += TIER_MEDIUM;
  else score += TIER_LOW;

  // Tier 2: Severity within status
  if (c.severity === "REQUIRED") score += 0;
  else if (c.severity === "IMPORTANT") score += 3;
  else score += 6;

  // Tier 3: Due date urgency
  if (c.dueDate) {
    const daysUntilDue = Math.floor((new Date(c.dueDate).getTime() - Date.now()) / 86400000);
    if (daysUntilDue <= 3) score -= 5;
    else if (daysUntilDue <= 7) score -= 2;
  }

  // Tier 4: Stalled items get slight boost
  if (c.stalledDays && c.stalledDays > 5) score -= 1;

  return score;
}

function conditionToAction(c: ScoredCondition): BorrowerAction {
  if (c.status === "rejected") {
    return {
      type: "review_rejected_item",
      title: `Re-upload: ${c.title}`,
      description: c.rejectionReason
        ? `Your previous submission was not accepted. ${humanizeRejection(c.rejectionReason)}`
        : "Your previous submission did not meet the requirements. Please upload a replacement.",
      rationale: "This item needs a new submission before your file can move forward.",
      linkedConditionId: c.id,
      priority: "critical",
      estimatedMinutes: 10,
      ctaLabel: "Re-upload",
      ctaTarget: null,
    };
  }

  if (c.status === "partially_satisfied") {
    return {
      type: "upload_document",
      title: `Complete: ${c.title}`,
      description: "We received some of what's needed, but additional documentation is required.",
      rationale: "Providing the remaining items will help complete this requirement.",
      linkedConditionId: c.id,
      priority: c.severity === "REQUIRED" ? "high" : "medium",
      estimatedMinutes: 10,
      ctaLabel: "Upload More",
      ctaTarget: null,
    };
  }

  // pending
  const priority: ActionPriority = c.severity === "REQUIRED" ? "high" : c.severity === "IMPORTANT" ? "medium" : "low";
  return {
    type: "upload_document",
    title: `Upload: ${c.title}`,
    description: `We need this item to evaluate your application.`,
    rationale: c.severity === "REQUIRED"
      ? "This is a required item — your file cannot move forward without it."
      : "Providing this will strengthen your application.",
    linkedConditionId: c.id,
    priority,
    estimatedMinutes: 15,
    ctaLabel: "Upload",
    ctaTarget: null,
  };
}

function humanizeRejection(reason: string): string {
  const map: Record<string, string> = {
    wrong_date_range: "The document covers the wrong time period.",
    incomplete_document: "The document appears incomplete or missing pages.",
    unreadable_upload: "The upload was not readable — try a clearer scan.",
    wrong_entity: "The document is for a different business or person.",
    missing_signature: "A required signature is missing.",
    wrong_document_type: "This is not the type of document we need.",
  };
  return map[reason] ?? "";
}
