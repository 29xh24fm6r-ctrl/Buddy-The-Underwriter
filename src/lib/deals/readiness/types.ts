// Pure types for the unified deal readiness model.
//
// PURITY: no server-only imports. Consumed both by server build paths and
// by CI guard tests.

import type { LifecycleStage } from "@/buddy/lifecycle/model";

export type ReadinessGroupKey =
  | "documents"
  | "financials"
  | "research"
  | "memo_inputs"
  | "credit_memo";

export type BlockerOwner = "banker" | "borrower" | "buddy" | "underwriter";
export type BlockerSeverity = "blocker" | "warning";

export type UnifiedBlocker = {
  code: string;
  label: string;
  group: ReadinessGroupKey;
  owner: BlockerOwner;
  severity: BlockerSeverity;
  fixPath: string;
  fixLabel: string;
};

export type ReadinessGroup = {
  key: ReadinessGroupKey;
  label: string;
  ready: boolean;
  // 0..100 — group's own contribution. Used for per-section indicators.
  score: number;
  blockers: UnifiedBlocker[];
  warnings: UnifiedBlocker[];
};

export type UnifiedNextActionKind = "navigate" | "run" | "wait" | "fix";

export type UnifiedNextAction = {
  label: string;
  href: string;
  owner: BlockerOwner;
  kind: UnifiedNextActionKind;
  // Optional rationale shown beneath the action (e.g. "Required before submit").
  reason?: string;
};

export type UnifiedDealReadiness = {
  dealId: string;
  ready: boolean;
  stage: LifecycleStage;
  // Aggregate 0..100 — weighted across groups, see buildUnifiedDealReadiness.
  score: number;
  groups: Record<ReadinessGroupKey, ReadinessGroup>;
  blockers: UnifiedBlocker[];
  warnings: UnifiedBlocker[];
  next_action: UnifiedNextAction;
  evaluatedAt: string;
  contractVersion: "unified_readiness_v1";
};
