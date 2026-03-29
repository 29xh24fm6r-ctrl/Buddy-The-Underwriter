// Pure function. No DB. No side effects. No network.
import type {
  DecisionKernelInput,
  DecisionCandidate,
  CanonicalPrimaryActionCode,
  SystemTier,
  ActionabilityContract,
} from "./types";

const TIER_WEIGHTS: Record<SystemTier, number> = {
  integrity: 10000,
  critical_distress: 8000,
  time_bound_work: 6000,
  borrower_blocked: 4000,
  protection: 3000,
  growth: 2000,
  informational: 1000,
};

function makeActionability(overrides: Partial<ActionabilityContract> = {}): ActionabilityContract {
  return {
    isActionableNow: true,
    actorType: "banker",
    actorId: null,
    dueAt: null,
    blockerType: "none",
    blockerDetail: null,
    closureCondition: "Action completed",
    escalationCondition: null,
    deeplink: "",
    ...overrides,
  };
}

/**
 * Build all candidate actions from input signals.
 * Each candidate represents a possible primary action with its tier and scoring weights.
 */
export function buildCandidates(input: DecisionKernelInput): DecisionCandidate[] {
  const candidates: DecisionCandidate[] = [];

  // Tier 1: Integrity
  if (input.hasIntegrityIssue) {
    candidates.push({
      actionCode: "repair_integrity",
      tier: "integrity",
      tierWeight: TIER_WEIGHTS.integrity,
      severityWeight: 100,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 100,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Repair data integrity",
      targetType: "relationship",
      targetId: input.relationshipId,
      whyNow: "Canonical relationship data has integrity issues that must be resolved before other work.",
      evidence: input.evidence.filter((e) => input.integrityIssueIds.includes(e.sourceId)),
      actionability: makeActionability({ closureCondition: "Integrity issue resolved" }),
    });
  }

  // Tier 2: Critical distress
  if (input.activeWorkoutCaseId && input.overdueWorkoutActionIds.length > 0) {
    candidates.push({
      actionCode: "resolve_overdue_workout_action",
      tier: "critical_distress",
      tierWeight: TIER_WEIGHTS.critical_distress,
      severityWeight: input.workoutSeverity === "critical" ? 100 : 80,
      deadlineWeight: 100,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 80,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Resolve overdue workout action",
      targetType: "action_item",
      targetId: input.overdueWorkoutActionIds[0],
      whyNow: "A workout action item is overdue and requires immediate attention.",
      evidence: input.evidence.filter((e) => e.sourceType === "workout_case"),
      actionability: makeActionability({
        dueAt: null,
        closureCondition: "All overdue action items resolved",
        escalationCondition: "Continued inaction may require committee escalation",
      }),
    });
  }

  if (input.activeWorkoutCaseId) {
    candidates.push({
      actionCode: "advance_workout_strategy",
      tier: "critical_distress",
      tierWeight: TIER_WEIGHTS.critical_distress,
      severityWeight: input.workoutSeverity === "critical" ? 90 : 70,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 60,
      freshnessPenalty: (input.workoutStaleDays ?? 0) > 14 ? 50 : 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Advance workout strategy",
      targetType: "case",
      targetId: input.activeWorkoutCaseId,
      whyNow: input.workoutStaleDays && input.workoutStaleDays > 14
        ? `Workout has been stalled for ${input.workoutStaleDays} days.`
        : "Active workout case requires strategy advancement.",
      evidence: input.evidence.filter((e) => e.sourceType === "workout_case"),
      actionability: makeActionability({ closureCondition: "Workout stage advanced or resolved" }),
    });
  }

  if (input.activeWatchlistCaseId && input.watchlistSeverity === "critical") {
    candidates.push({
      actionCode: "escalate_watchlist_to_workout",
      tier: "critical_distress",
      tierWeight: TIER_WEIGHTS.critical_distress,
      severityWeight: 85,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 70,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Escalate watchlist to workout",
      targetType: "case",
      targetId: input.activeWatchlistCaseId,
      whyNow: "Critical watchlist severity warrants workout escalation.",
      evidence: input.evidence.filter((e) => e.sourceType === "watchlist_case"),
      actionability: makeActionability({ closureCondition: "Escalated to workout or severity downgraded" }),
    });
  }

  if (input.activeWatchlistCaseId && input.watchlistSeverity !== "critical") {
    candidates.push({
      actionCode: "review_watchlist_case",
      tier: "critical_distress",
      tierWeight: TIER_WEIGHTS.critical_distress,
      severityWeight: input.watchlistSeverity === "high" ? 60 : 40,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 40,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Review watchlist case",
      targetType: "case",
      targetId: input.activeWatchlistCaseId,
      whyNow: "Active watchlist case requires review.",
      evidence: input.evidence.filter((e) => e.sourceType === "watchlist_case"),
      actionability: makeActionability({ closureCondition: "Case reviewed and action determined" }),
    });
  }

  if (input.hasCryptoLiquidationReview) {
    candidates.push({
      actionCode: "approve_crypto_liquidation",
      tier: "critical_distress",
      tierWeight: TIER_WEIGHTS.critical_distress,
      severityWeight: 95,
      deadlineWeight: 100,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 100,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Review liquidation request",
      targetType: "case",
      targetId: input.cryptoLiquidationEventId,
      whyNow: "Crypto collateral has breached liquidation thresholds. Banker approval required.",
      evidence: input.evidence.filter((e) => e.sourceType === "crypto_valuation"),
      actionability: makeActionability({
        blockerType: "approval",
        closureCondition: "Liquidation approved or declined",
      }),
    });
  }

  if (input.hasCryptoCurePending) {
    candidates.push({
      actionCode: "advance_crypto_cure",
      tier: "critical_distress",
      tierWeight: TIER_WEIGHTS.critical_distress,
      severityWeight: 75,
      deadlineWeight: 80,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 60,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Advance crypto cure",
      targetType: "case",
      targetId: input.cryptoCureEventId,
      whyNow: "Margin call cure is in progress and requires advancement.",
      evidence: input.evidence.filter((e) => e.sourceType === "crypto_valuation"),
      actionability: makeActionability({ closureCondition: "Cure completed or escalated" }),
    });
  }

  // Tier 3: Time-bound work
  if (input.hasRenewalOverdue) {
    candidates.push({
      actionCode: "prepare_renewal_decision",
      tier: "time_bound_work",
      tierWeight: TIER_WEIGHTS.time_bound_work,
      severityWeight: 80,
      deadlineWeight: input.renewalDueAt ? 100 : 50,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 80,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Prepare renewal decision",
      targetType: "case",
      targetId: input.renewalId,
      whyNow: "Renewal is overdue and requires decision.",
      evidence: [],
      actionability: makeActionability({
        dueAt: input.renewalDueAt,
        closureCondition: "Renewal decision made",
      }),
    });
  }

  if (input.hasAnnualReviewOverdue) {
    candidates.push({
      actionCode: "prepare_annual_review",
      tier: "time_bound_work",
      tierWeight: TIER_WEIGHTS.time_bound_work,
      severityWeight: 70,
      deadlineWeight: 80,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 70,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Prepare annual review",
      targetType: "case",
      targetId: input.annualReviewId,
      whyNow: "Annual review is overdue.",
      evidence: [],
      actionability: makeActionability({ closureCondition: "Annual review completed" }),
    });
  }

  // Tier 4: Borrower-blocked
  if (input.hasBorrowerOverdue && input.borrowerRequestIds.length > 0) {
    candidates.push({
      actionCode: "collect_borrower_requirement",
      tier: "borrower_blocked",
      tierWeight: TIER_WEIGHTS.borrower_blocked,
      severityWeight: 50,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 80,
      relationshipValueWeight: 0,
      policyWeight: 0,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Collect borrower requirements",
      targetType: "case",
      targetId: input.borrowerRequestIds[0],
      whyNow: "Borrower has overdue items blocking progress.",
      evidence: [],
      actionability: makeActionability({
        actorType: "borrower",
        blockerType: "borrower",
        closureCondition: "Borrower items received",
      }),
    });
  }

  // Tier 5: Protection
  if (input.hasProtectionWork && input.protectionCaseId) {
    candidates.push({
      actionCode: "address_protection_risk",
      tier: "protection",
      tierWeight: TIER_WEIGHTS.protection,
      severityWeight: input.protectionSeverity === "critical" ? 80 : 40,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 0,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Address protection risk",
      targetType: "case",
      targetId: input.protectionCaseId,
      whyNow: "Relationship protection risk requires attention.",
      evidence: [],
      actionability: makeActionability({ closureCondition: "Protection case resolved" }),
    });
  }

  if (input.hasCryptoWarning && !input.hasCryptoLiquidationReview && !input.hasCryptoCurePending) {
    candidates.push({
      actionCode: "review_crypto_collateral",
      tier: "protection",
      tierWeight: TIER_WEIGHTS.protection,
      severityWeight: 30,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 0,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Review crypto collateral",
      targetType: "position",
      targetId: null,
      whyNow: "Crypto collateral is approaching warning thresholds.",
      evidence: input.evidence.filter((e) => e.sourceType === "crypto_valuation"),
      actionability: makeActionability({ closureCondition: "Collateral reviewed" }),
    });
  }

  // Tier 6: Growth
  if (input.hasGrowthWork && input.growthCaseId) {
    candidates.push({
      actionCode: "advance_growth_case",
      tier: "growth",
      tierWeight: TIER_WEIGHTS.growth,
      severityWeight: 20,
      deadlineWeight: 0,
      evidenceWeight: 0,
      blockerWeight: 0,
      relationshipValueWeight: 0,
      policyWeight: 0,
      freshnessPenalty: 0,
      suppressibilityPenalty: 0,
      totalScore: 0,
      label: "Advance growth opportunity",
      targetType: "case",
      targetId: input.growthCaseId,
      whyNow: "Growth opportunity identified for this relationship.",
      evidence: [],
      actionability: makeActionability({ closureCondition: "Growth case advanced or closed" }),
    });
  }

  // Tier 7: Informational (always present as fallback)
  candidates.push({
    actionCode: "monitor_only",
    tier: "informational",
    tierWeight: TIER_WEIGHTS.informational,
    severityWeight: 0,
    deadlineWeight: 0,
    evidenceWeight: 0,
    blockerWeight: 0,
    relationshipValueWeight: 0,
    policyWeight: 0,
    freshnessPenalty: 0,
    suppressibilityPenalty: 0,
    totalScore: 0,
    label: "Monitor only",
    targetType: "relationship",
    targetId: input.relationshipId,
    whyNow: "Relationship is healthy. No immediate action required.",
    evidence: [],
    actionability: makeActionability({
      isActionableNow: false,
      closureCondition: "N/A",
    }),
  });

  return candidates;
}
