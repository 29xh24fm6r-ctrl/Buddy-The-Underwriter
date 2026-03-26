/**
 * Phase 54B — Borrower Readiness Calculator
 *
 * Replaces placeholder readiness-score logic with real condition/evidence signals.
 * Score is for progress/readiness, NOT credit approval probability.
 *
 * Pure function — no DB calls.
 */

import type { CanonicalConditionStatus } from "@/lib/conditions/deriveConditionStatus";
import type { BorrowerReadiness, ReadinessLabel } from "./types";

export type ReadinessCondition = {
  status: CanonicalConditionStatus;
  severity: "REQUIRED" | "IMPORTANT" | "FYI" | string | null;
};

/**
 * Calculate borrower readiness from live condition state.
 */
export function calculateBorrowerReadiness(conditions: ReadinessCondition[]): BorrowerReadiness {
  if (conditions.length === 0) {
    return {
      score: 0,
      label: "Getting started",
      milestone: "No conditions loaded yet",
      summary: "Your underwriter will set up your requirements soon.",
      blockersCount: 0,
      criticalItemsRemaining: 0,
      docsWaitingReview: 0,
      docsRejectedCount: 0,
      partialItemsCount: 0,
    };
  }

  const required = conditions.filter((c) => c.severity === "REQUIRED");
  const important = conditions.filter((c) => c.severity === "IMPORTANT");

  const terminal = new Set<CanonicalConditionStatus>(["satisfied", "waived"]);
  const review = new Set<CanonicalConditionStatus>(["submitted", "under_review"]);

  const requiredComplete = required.filter((c) => terminal.has(c.status)).length;
  const importantComplete = important.filter((c) => terminal.has(c.status)).length;
  const allComplete = conditions.filter((c) => terminal.has(c.status)).length;

  const rejected = conditions.filter((c) => c.status === "rejected").length;
  const partial = conditions.filter((c) => c.status === "partially_satisfied").length;
  const waiting = conditions.filter((c) => review.has(c.status)).length;
  const pending = conditions.filter((c) => c.status === "pending").length;

  const criticalRemaining = required.filter((c) => !terminal.has(c.status)).length;

  // Weighted score:
  // - Required items: 70% weight
  // - Important items: 20% weight
  // - Other items: 10% weight
  const requiredScore = required.length > 0
    ? (requiredComplete / required.length) * 70
    : 70; // No required items = full required credit
  const importantScore = important.length > 0
    ? (importantComplete / important.length) * 20
    : 20;
  const otherCount = conditions.length - required.length - important.length;
  const otherComplete = allComplete - requiredComplete - importantComplete;
  const otherScore = otherCount > 0
    ? (otherComplete / otherCount) * 10
    : 10;

  let rawScore = Math.round(requiredScore + importantScore + otherScore);

  // Gates: rejection and critical pending items cap the score
  if (rejected > 0) rawScore = Math.min(rawScore, 70);
  if (criticalRemaining > 3) rawScore = Math.min(rawScore, 50);

  const score = Math.max(0, Math.min(100, rawScore));
  const label = scoreToLabel(score);
  const milestone = buildMilestone(score, criticalRemaining, rejected);
  const summary = buildSummary(allComplete, conditions.length, criticalRemaining, rejected, waiting);

  return {
    score,
    label,
    milestone,
    summary,
    blockersCount: criticalRemaining + rejected,
    criticalItemsRemaining: criticalRemaining,
    docsWaitingReview: waiting,
    docsRejectedCount: rejected,
    partialItemsCount: partial,
  };
}

function scoreToLabel(score: number): ReadinessLabel {
  if (score >= 95) return "File ready for review";
  if (score >= 75) return "Almost underwriter-ready";
  if (score >= 50) return "Making strong progress";
  if (score >= 25) return "Building your file";
  return "Getting started";
}

function buildMilestone(score: number, criticalRemaining: number, rejected: number): string {
  if (score >= 95) return "All items received — your file is ready for underwriting review.";
  if (score >= 75) return `Almost there! ${criticalRemaining} required item${criticalRemaining !== 1 ? "s" : ""} remaining.`;
  if (score >= 50) return "Good progress — keep uploading the remaining items.";
  if (score >= 25) return "We have some of what we need. Upload more to keep moving.";
  return "Let's get started — upload your first documents.";
}

function buildSummary(
  complete: number,
  total: number,
  criticalRemaining: number,
  rejected: number,
  waiting: number,
): string {
  const parts: string[] = [];
  parts.push(`${complete} of ${total} items complete.`);
  if (criticalRemaining > 0) parts.push(`${criticalRemaining} required item${criticalRemaining !== 1 ? "s" : ""} still needed.`);
  if (rejected > 0) parts.push(`${rejected} item${rejected !== 1 ? "s" : ""} need${rejected === 1 ? "s" : ""} re-upload.`);
  if (waiting > 0) parts.push(`${waiting} item${waiting !== 1 ? "s" : ""} under review.`);
  return parts.join(" ");
}
