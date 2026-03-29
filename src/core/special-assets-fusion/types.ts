// Phase 65M — Special Assets Fusion Types
// Zero runtime imports. Pure type definitions only.

// ─── Relationship-level distress state ────────────────────────────────────────

export type RelationshipDistressState =
  | "healthy"
  | "monitored"
  | "watchlist_exposure"
  | "workout_exposure"
  | "mixed_distress"
  | "resolved";

// ─── SLA cadence by severity ──────────────────────────────────────────────────

export type WatchlistReviewCadence = {
  severity: "low" | "moderate" | "high" | "critical";
  reviewIntervalDays: number;
};

export const WATCHLIST_REVIEW_CADENCE: WatchlistReviewCadence[] = [
  { severity: "low", reviewIntervalDays: 30 },
  { severity: "moderate", reviewIntervalDays: 14 },
  { severity: "high", reviewIntervalDays: 7 },
  { severity: "critical", reviewIntervalDays: 3 },
];

export type WorkoutMilestoneCadence = {
  stage: string;
  milestoneIntervalDays: number;
};

export const WORKOUT_MILESTONE_CADENCE: WorkoutMilestoneCadence[] = [
  { stage: "triage", milestoneIntervalDays: 7 },
  { stage: "diagnosis", milestoneIntervalDays: 14 },
  { stage: "action_plan", milestoneIntervalDays: 14 },
  { stage: "negotiation", milestoneIntervalDays: 21 },
  { stage: "approval", milestoneIntervalDays: 7 },
  { stage: "execution", milestoneIntervalDays: 30 },
  { stage: "resolution", milestoneIntervalDays: 14 },
];

// ─── Resolution record ────────────────────────────────────────────────────────

export type ResolutionOutcome =
  | "returned_to_pass"
  | "resolved_by_cure"
  | "resolved_by_modification"
  | "refinanced_out"
  | "liquidated"
  | "charged_off"
  | "paid_off"
  | "other";

export type ResolutionRecord = {
  outcome: ResolutionOutcome;
  summary: string;
  evidenceIds: string[];
  approvedByUserId: string | null;
  resolvedAt: string;
};

// ─── Workout decision matrix ──────────────────────────────────────────────────

export type WorkoutStrategy =
  | "short_term_cure"
  | "modification"
  | "forbearance"
  | "refinance_exit"
  | "liquidation"
  | "legal_enforcement"
  | "structured_sale"
  | "dil"
  | "other";

export type WorkoutDecisionMatrix = {
  currentStrategy: WorkoutStrategy;
  viableAlternatives: WorkoutStrategy[];
  blockers: string[];
  nextMilestone: string;
  nextMilestoneDueAt: string | null;
  escalationRisk: "low" | "moderate" | "high" | "critical";
};

// ─── Distress queue projection ────────────────────────────────────────────────

export type DistressQueueProjection = {
  systemTier: string;
  distressState: string;
  activeCaseType: "watchlist" | "workout" | null;
  severity: string | null;
  nextMilestoneAt: string | null;
  overdueActionCount: number;
  staleDays: number | null;
  primaryActionCode: string | null;
};

// ─── Distress rollup input ────────────────────────────────────────────────────

export type DistressRollupInput = {
  deals: Array<{
    dealId: string;
    operatingState: string;
    activeWatchlistSeverity: string | null;
    activeWorkoutSeverity: string | null;
  }>;
};

// ─── SLA check input ──────────────────────────────────────────────────────────

export type SLACheckInput = {
  caseType: "watchlist" | "workout";
  severity: string;
  stage: string | null;
  lastReviewAt: string | null;
  nextMilestoneDueAt: string | null;
  lastMaterialActivityAt: string | null;
  nowIso: string;
};

export type SLACheckResult = {
  reviewOverdue: boolean;
  milestoneOverdue: boolean;
  stalled: boolean;
  stalledDays: number;
  nextReviewDueAt: string | null;
};
