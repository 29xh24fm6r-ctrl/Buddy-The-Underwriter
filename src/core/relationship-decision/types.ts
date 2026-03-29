// Phase 65K.6 — Relationship Decision Kernel Types
// Zero runtime imports. Pure type definitions only.

// ─── System Tier ──────────────────────────────────────────────────────────────

export const TIER_ORDER = [
  "integrity",
  "critical_distress",
  "time_bound_work",
  "borrower_blocked",
  "protection",
  "growth",
  "informational",
] as const;

export type SystemTier = (typeof TIER_ORDER)[number];

// ─── Evidence Envelope ────────────────────────────────────────────────────────

export type EvidenceEnvelope = {
  evidenceId: string;
  sourceType:
    | "financial_statement"
    | "covenant_test"
    | "monitoring_event"
    | "review_exception"
    | "watchlist_case"
    | "workout_case"
    | "timeline_event"
    | "manual_attestation"
    | "crypto_valuation"
    | "document";
  sourceId: string;
  assertedFact: string;
  assertedValue: string | number | boolean | null;
  observedAt: string;
  freshnessClass: "live" | "recent" | "stale";
  derivation: "direct" | "deterministic_derived" | "manual";
  confidence: "certain" | "high" | "medium";
  lineage: string[];
  policyRelevant: boolean;
};

// ─── Actionability Contract ───────────────────────────────────────────────────

export type ActionabilityContract = {
  isActionableNow: boolean;
  actorType: "banker" | "borrower" | "system";
  actorId: string | null;
  dueAt: string | null;
  blockerType: "none" | "borrower" | "policy" | "evidence" | "approval";
  blockerDetail: string | null;
  closureCondition: string;
  escalationCondition: string | null;
  deeplink: string;
};

// ─── Canonical Primary Action ─────────────────────────────────────────────────

export type CanonicalPrimaryActionCode =
  | "repair_integrity"
  | "review_watchlist_case"
  | "escalate_watchlist_to_workout"
  | "advance_workout_strategy"
  | "resolve_overdue_workout_action"
  | "prepare_annual_review"
  | "prepare_renewal_decision"
  | "collect_borrower_requirement"
  | "address_protection_risk"
  | "advance_growth_case"
  | "approve_crypto_liquidation"
  | "advance_crypto_cure"
  | "review_crypto_collateral"
  | "monitor_only";

export type CanonicalPrimaryAction = {
  code: CanonicalPrimaryActionCode;
  targetType: "relationship" | "deal" | "case" | "action_item" | "position";
  targetId: string | null;
  label: string;
  tier: SystemTier;
};

export type CanonicalSecondaryAction = {
  code: string;
  label: string;
  tier: SystemTier;
  targetType: string;
  targetId: string | null;
};

// ─── Queue Reason ─────────────────────────────────────────────────────────────

export type QueueReasonCode = string;

// ─── Decision Conflict ────────────────────────────────────────────────────────

export type DecisionConflict = {
  conflictType:
    | "active_workout_and_performing"
    | "dual_active_watchlist"
    | "missing_evidence_for_distress"
    | "review_complete_without_evidence"
    | "growth_over_protection"
    | "conflicting_cases";
  description: string;
  severity: "warning" | "error";
  relatedIds: string[];
};

// ─── Action Lease ─────────────────────────────────────────────────────────────

export type ActionLease = {
  actionCode: string;
  acquiredAt: string;
  reevaluateAt: string;
  supersedableByHigherTier: boolean;
  expiresAt: string | null;
};

// ─── Decision Envelope ────────────────────────────────────────────────────────

export type RelationshipDecisionEnvelope = {
  relationshipId: string;
  decidedAt: string;
  asOf: string;

  systemTier: SystemTier;

  primaryAction: CanonicalPrimaryAction | null;
  secondaryActions: CanonicalSecondaryAction[];
  queueReasons: QueueReasonCode[];
  whyNow: string;
  whyNotElse: string[];
  actionability: ActionabilityContract;
  evidence: EvidenceEnvelope[];
  conflicts: DecisionConflict[];
  freshness: {
    recomputeRequired: boolean;
    staleInputs: string[];
  };
  diagnostics: {
    kernelVersion: string;
    rulesApplied: string[];
    degraded: boolean;
    degradedReasons: string[];
  };
};

// ─── Decision Candidate ───────────────────────────────────────────────────────

export type DecisionCandidate = {
  actionCode: CanonicalPrimaryActionCode;
  tier: SystemTier;
  tierWeight: number;
  severityWeight: number;
  deadlineWeight: number;
  evidenceWeight: number;
  blockerWeight: number;
  relationshipValueWeight: number;
  policyWeight: number;
  freshnessPenalty: number;
  suppressibilityPenalty: number;
  totalScore: number;
  label: string;
  targetType: string;
  targetId: string | null;
  whyNow: string;
  evidence: EvidenceEnvelope[];
  actionability: ActionabilityContract;
};

// ─── Decision Input ───────────────────────────────────────────────────────────

export type DecisionKernelInput = {
  relationshipId: string;
  asOf: string;

  // Truth state
  hasIntegrityIssue: boolean;
  integrityIssueIds: string[];

  // Distress state
  activeWatchlistCaseId: string | null;
  watchlistSeverity: string | null;
  activeWorkoutCaseId: string | null;
  workoutSeverity: string | null;
  workoutStage: string | null;
  overdueWorkoutActionIds: string[];
  workoutStaleDays: number | null;

  // Crypto state
  hasCryptoLiquidationReview: boolean;
  cryptoLiquidationEventId: string | null;
  hasCryptoCurePending: boolean;
  cryptoCureEventId: string | null;
  hasCryptoWarning: boolean;

  // Review state
  hasAnnualReviewOverdue: boolean;
  annualReviewId: string | null;
  hasRenewalOverdue: boolean;
  renewalId: string | null;
  renewalDueAt: string | null;
  hasBankerDeadline: boolean;
  bankerDeadlineAt: string | null;

  // Borrower state
  hasBorrowerOverdue: boolean;
  borrowerRequestIds: string[];

  // Protection state
  hasProtectionWork: boolean;
  protectionCaseId: string | null;
  protectionSeverity: string | null;

  // Growth state
  hasGrowthWork: boolean;
  growthCaseId: string | null;

  // Context
  relationshipExposureUsd: number | null;
  operatingState: string;
  evidence: EvidenceEnvelope[];
};

// ─── Omega Prime Context ──────────────────────────────────────────────────────

export type OmegaPrimeDecisionContext = {
  relationshipId: string;
  canonicalPrimaryAction: CanonicalPrimaryAction | null;
  systemTier: SystemTier;
  whyNow: string;
  whyNotElse: string[];
  queueReasons: QueueReasonCode[];
  evidenceSummary: {
    totalCount: number;
    policyRelevantCount: number;
    staleCount: number;
  };
  secondaryOpportunities: CanonicalSecondaryAction[];
  conflictNotes: string[];
  kernelVersion: string;
};
