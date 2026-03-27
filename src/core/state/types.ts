/**
 * Canonical State Types — Phase 65A
 *
 * BuddyCanonicalState is the SINGLE source of truth for deal state.
 * No surface, activation file, or component may compute lifecycle,
 * readiness, risk, or next step independently.
 */

import type { LifecycleStage, LifecycleBlocker, LifecycleDerived } from "@/buddy/lifecycle/model";

/** Pricing state derived from lifecycle fields */
export type PricingState = {
  hasPricingAssumptions: boolean;
  pricingQuoteReady: boolean;
  riskPricingFinalized: boolean;
  structuralPricingReady: boolean;
};

/** Committee state summary */
export type CommitteeState = {
  required: boolean;
  outcome: "approve" | "approve_with_conditions" | "decline" | "pending" | "not_applicable";
  voteCount: number;
  quorum: number;
  complete: boolean;
};

/** Exception state summary */
export type ExceptionSummary = {
  openCount: number;
  criticalCount: number;
  hasEscalated: boolean;
};

/** Checklist readiness summary */
export type ChecklistReadiness = {
  ready: boolean;
  reason: string;
  totalItems: number;
  satisfiedItems: number;
  missingItems: number;
};

/** Next required action — 100% Buddy-owned, no Omega input */
export type SystemAction = {
  label: string;
  href?: string;
  intent: "advance" | "navigate" | "blocked" | "complete" | "runnable";
  description?: string;
};

/** The single canonical state object for a deal */
export type BuddyCanonicalState = {
  dealId: string;

  lifecycle: LifecycleStage;
  blockers: LifecycleBlocker[];
  derived: LifecycleDerived;

  pricingState: PricingState;
  committeeState: CommitteeState;
  checklistReadiness: ChecklistReadiness;
  exceptionState: ExceptionSummary;

  nextRequiredAction: SystemAction;

  derivedAt: string;
};
