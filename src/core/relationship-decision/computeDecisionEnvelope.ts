// Pure function. No DB. No side effects. No network.
import type {
  DecisionKernelInput,
  RelationshipDecisionEnvelope,
  SystemTier,
} from "./types";
import { buildCandidates } from "./buildCandidates";
import { scoreCandidates } from "./scoreCandidates";
import { detectDecisionConflicts } from "./detectDecisionConflicts";

export const KERNEL_VERSION = "rdk_v1";

/**
 * Compute the canonical relationship decision envelope.
 * This is the core of the Relationship Decision Kernel.
 *
 * Invariants:
 * - Exactly one primary action
 * - No AI-generated state transitions
 * - No distress without evidence
 * - No growth outranks protection/distress
 * - Every decision carries evidence
 * - Fully deterministic and recomputable
 */
export function computeDecisionEnvelope(
  input: DecisionKernelInput,
): RelationshipDecisionEnvelope {
  const candidates = buildCandidates(input);
  const scored = scoreCandidates(candidates);
  const conflicts = detectDecisionConflicts(input);

  const winner = scored[0];
  const secondaries = scored
    .slice(1)
    .filter((c) => c.actionCode !== "monitor_only")
    .slice(0, 4);

  // Build queue reasons from all active signals
  const queueReasons: string[] = [];
  if (input.activeWatchlistCaseId) queueReasons.push("watchlist_active");
  if (input.activeWorkoutCaseId) queueReasons.push("workout_active");
  if (input.overdueWorkoutActionIds.length > 0) queueReasons.push("workout_action_overdue");
  if (input.workoutStaleDays && input.workoutStaleDays > 14) queueReasons.push("workout_stalled");
  if (input.hasCryptoLiquidationReview) queueReasons.push("crypto_liquidation_review_required");
  if (input.hasCryptoCurePending) queueReasons.push("crypto_margin_cure_pending");
  if (input.hasCryptoWarning) queueReasons.push("crypto_warning_open");
  if (input.hasRenewalOverdue) queueReasons.push("renewal_overdue");
  if (input.hasAnnualReviewOverdue) queueReasons.push("annual_review_overdue");
  if (input.hasBorrowerOverdue) queueReasons.push("borrower_items_overdue");
  if (input.hasProtectionWork) queueReasons.push("protection_work_required");
  if (input.hasGrowthWork) queueReasons.push("growth_opportunity");

  // Build why-not-else explanations
  const whyNotElse = secondaries.map(
    (s) => `${s.label} (${s.tier}, score ${s.totalScore}) deferred in favor of higher-priority work.`,
  );

  // Detect stale inputs
  const staleInputs = input.evidence
    .filter((e) => e.freshnessClass === "stale")
    .map((e) => e.sourceId);

  // Rules applied
  const rulesApplied: string[] = [];
  if (input.hasIntegrityIssue) rulesApplied.push("integrity_first");
  if (input.activeWorkoutCaseId && input.hasGrowthWork) rulesApplied.push("distress_suppresses_growth");
  if (input.hasCryptoLiquidationReview) rulesApplied.push("crypto_liquidation_gate");
  if (conflicts.length > 0) rulesApplied.push("conflict_detection");

  return {
    relationshipId: input.relationshipId,
    decidedAt: input.asOf,
    asOf: input.asOf,
    systemTier: winner.tier,
    primaryAction: {
      code: winner.actionCode,
      targetType: winner.targetType as any,
      targetId: winner.targetId,
      label: winner.label,
      tier: winner.tier,
    },
    secondaryActions: secondaries.map((s) => ({
      code: s.actionCode,
      label: s.label,
      tier: s.tier,
      targetType: s.targetType,
      targetId: s.targetId,
    })),
    queueReasons,
    whyNow: winner.whyNow,
    whyNotElse,
    actionability: winner.actionability,
    evidence: winner.evidence,
    conflicts,
    freshness: {
      recomputeRequired: staleInputs.length > 0,
      staleInputs,
    },
    diagnostics: {
      kernelVersion: KERNEL_VERSION,
      rulesApplied,
      degraded: conflicts.some((c) => c.severity === "error"),
      degradedReasons: conflicts
        .filter((c) => c.severity === "error")
        .map((c) => c.description),
    },
  };
}
