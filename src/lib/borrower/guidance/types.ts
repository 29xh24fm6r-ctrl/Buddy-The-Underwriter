/**
 * Phase 54B — Borrower Guidance Types
 *
 * Canonical types for the guidance engine, readiness model,
 * condition explanations, and banker friction insights.
 */

import type { CanonicalConditionStatus } from "@/lib/conditions/deriveConditionStatus";

// ---------------------------------------------------------------------------
// Primary Next Action
// ---------------------------------------------------------------------------

export type BorrowerActionType =
  | "upload_document"
  | "answer_question"
  | "connect_account"
  | "wait_for_review"
  | "review_rejected_item"
  | "resolve_conflict"
  | "complete_profile";

export type ActionPriority = "critical" | "high" | "medium" | "low";

export type BorrowerAction = {
  type: BorrowerActionType;
  title: string;
  description: string;
  rationale: string;
  linkedConditionId: string | null;
  priority: ActionPriority;
  estimatedMinutes: number | null;
  ctaLabel: string;
  ctaTarget: string | null;
};

// ---------------------------------------------------------------------------
// Per-Condition Guidance
// ---------------------------------------------------------------------------

export type ConditionGuidance = {
  conditionId: string;
  canonicalStatus: CanonicalConditionStatus;
  borrowerLabel: string;
  borrowerExplanation: string;
  whatWeReceived: string[];
  whatIsStillNeeded: string[];
  recommendedNextStep: string | null;
  examplesOfGoodEvidence: string[];
  confidenceIndicator: "high" | "medium" | "low" | "none";
  lastEventSummary: string | null;
};

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type ReadinessLabel =
  | "Getting started"
  | "Building your file"
  | "Making strong progress"
  | "Almost underwriter-ready"
  | "File ready for review";

export type BorrowerReadiness = {
  score: number; // 0–100
  label: ReadinessLabel;
  milestone: string;
  summary: string;
  blockersCount: number;
  criticalItemsRemaining: number;
  docsWaitingReview: number;
  docsRejectedCount: number;
  partialItemsCount: number;
};

// ---------------------------------------------------------------------------
// Full Guidance Payload
// ---------------------------------------------------------------------------

export type BorrowerGuidancePayload = {
  primaryNextAction: BorrowerAction | null;
  secondaryActions: BorrowerAction[];
  blockers: string[];
  readiness: BorrowerReadiness;
  conditionGuidance: ConditionGuidance[];
  milestones: Record<string, boolean>;
  warnings: string[];
  lastUpdatedAt: string;
};

// ---------------------------------------------------------------------------
// Banker Friction Insights
// ---------------------------------------------------------------------------

export type BorrowerFrictionInsights = {
  topFrictionConditions: Array<{
    conditionId: string;
    title: string;
    reason: string;
    stalledDays: number;
  }>;
  repeatedRejectionCount: number;
  borrowerHasActionableItems: boolean;
  waitingOnBankReview: boolean;
  likelyConfusedBorrower: boolean;
  currentBorrowerNextAction: string | null;
  readinessLabel: ReadinessLabel;
  readinessScore: number;
};
