/**
 * Phase 54A — Borrower Next Step Helper
 *
 * Lightweight prioritization: tells the borrower what to do next.
 * No scoring model, no advanced guidance — just a simple priority pass.
 */

import type { CanonicalConditionStatus } from "./deriveConditionStatus";

export type BorrowerConditionSummary = {
  id: string;
  title: string;
  status: CanonicalConditionStatus;
  severity?: "REQUIRED" | "IMPORTANT" | "FYI" | string | null;
  dueDate?: string | null;
};

export type BorrowerNextStepResult = {
  nextConditionId: string | null;
  nextConditionTitle: string | null;
  reason: string | null;
  counts: {
    total: number;
    completed: number;
    remaining: number;
    pending: number;
    submitted: number;
    underReview: number;
  };
};

const STATUS_PRIORITY: Record<CanonicalConditionStatus, number> = {
  pending: 0,            // needs action — highest priority
  rejected: 1,           // needs re-upload
  partially_satisfied: 2, // needs more evidence
  submitted: 3,          // waiting for review
  under_review: 4,       // waiting for automation
  satisfied: 10,         // done
  waived: 10,            // done
};

const SEVERITY_PRIORITY: Record<string, number> = {
  REQUIRED: 0,
  IMPORTANT: 1,
  FYI: 2,
};

const TERMINAL = new Set<CanonicalConditionStatus>(["satisfied", "waived"]);
const ACTIONABLE = new Set<CanonicalConditionStatus>(["pending", "rejected", "partially_satisfied"]);

/**
 * Determine the borrower's next recommended action.
 * Pure function — no DB calls.
 */
export function getBorrowerNextStep(conditions: BorrowerConditionSummary[]): BorrowerNextStepResult {
  const completed = conditions.filter((c) => TERMINAL.has(c.status));
  const remaining = conditions.filter((c) => !TERMINAL.has(c.status));
  const pending = conditions.filter((c) => c.status === "pending");
  const submitted = conditions.filter((c) => c.status === "submitted");
  const underReview = conditions.filter((c) => c.status === "under_review");

  const counts = {
    total: conditions.length,
    completed: completed.length,
    remaining: remaining.length,
    pending: pending.length,
    submitted: submitted.length,
    underReview: underReview.length,
  };

  if (remaining.length === 0) {
    return { nextConditionId: null, nextConditionTitle: null, reason: null, counts };
  }

  // Sort actionable items by: status priority → severity priority → due date
  const actionable = remaining
    .filter((c) => ACTIONABLE.has(c.status))
    .sort((a, b) => {
      const statusDiff = (STATUS_PRIORITY[a.status] ?? 5) - (STATUS_PRIORITY[b.status] ?? 5);
      if (statusDiff !== 0) return statusDiff;

      const sevA = SEVERITY_PRIORITY[a.severity ?? "FYI"] ?? 2;
      const sevB = SEVERITY_PRIORITY[b.severity ?? "FYI"] ?? 2;
      if (sevA !== sevB) return sevA - sevB;

      // Earlier due date first
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

  const next = actionable[0] ?? remaining[0];

  let reason: string;
  if (next.status === "pending") {
    reason = next.severity === "REQUIRED"
      ? "This required item has not been submitted yet"
      : "This item is needed to move forward";
  } else if (next.status === "rejected") {
    reason = "Previous submission was not accepted — please re-upload";
  } else if (next.status === "partially_satisfied") {
    reason = "Additional documentation is needed";
  } else {
    reason = "This item needs your attention";
  }

  return {
    nextConditionId: next.id,
    nextConditionTitle: next.title,
    reason,
    counts,
  };
}
