/**
 * Phase 55A — Canonical Financial Snapshot Types
 */

export type FinancialSnapshotStatus =
  | "not_started"
  | "collecting_inputs"
  | "generated"
  | "needs_review"
  | "partially_validated"
  | "validated"
  | "stale"
  | "superseded";

export type FinancialSnapshot = {
  id: string;
  dealId: string;
  bankId: string;
  status: FinancialSnapshotStatus;
  active: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  entityScope: Record<string, unknown> | null;
  sourceDocumentCount: number;
  materialFactCount: number;
  validatedFactCount: number;
  unresolvedConflictCount: number;
  missingFactCount: number;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
  supersededBy: string | null;
};

export type SnapshotCompletenessReport = {
  snapshotStatus: FinancialSnapshotStatus;
  completenessPercent: number;
  criticalMissingFacts: string[];
  unresolvedConflicts: Array<{ metricKey: string; period: string; conflictSources: number }>;
  staleReasons: string[];
  reviewRequired: boolean;
  decisionSafe: boolean;
  memoSafe: boolean;
  nextRecommendedAction: string | null;
};

export type SnapshotGateResult = {
  snapshotPresent: boolean;
  snapshotStatus: FinancialSnapshotStatus | null;
  financialBlockers: string[];
  memoSafe: boolean;
  decisionSafe: boolean;
};

export type SnapshotDiff = {
  changedFacts: Array<{ metricKey: string; period: string; oldValue: number | null; newValue: number | null }>;
  removedFacts: Array<{ metricKey: string; period: string }>;
  newFacts: Array<{ metricKey: string; period: string; value: number | null }>;
  materialitySummary: string;
  shouldMarkStale: boolean;
  shouldAutoRebuild: boolean;
};
