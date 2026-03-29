// Pure function. No DB. No side effects. No network.
import type { DecisionKernelInput, DecisionConflict } from "./types";

/**
 * Detect conflicting or impossible states in the decision input.
 */
export function detectDecisionConflicts(
  input: DecisionKernelInput,
): DecisionConflict[] {
  const conflicts: DecisionConflict[] = [];

  // Active workout + performing state
  if (input.activeWorkoutCaseId && input.operatingState === "performing") {
    conflicts.push({
      conflictType: "active_workout_and_performing",
      description: "Deal has an active workout case but operating state is 'performing'. State is inconsistent.",
      severity: "error",
      relatedIds: [input.activeWorkoutCaseId],
    });
  }

  // Watchlist + workout simultaneously (should be escalated, not both active)
  if (input.activeWatchlistCaseId && input.activeWorkoutCaseId) {
    conflicts.push({
      conflictType: "conflicting_cases",
      description: "Both a watchlist case and workout case are active. Watchlist should have been escalated.",
      severity: "warning",
      relatedIds: [input.activeWatchlistCaseId, input.activeWorkoutCaseId],
    });
  }

  // Distress asserted without evidence
  if (
    (input.activeWatchlistCaseId || input.activeWorkoutCaseId) &&
    input.evidence.filter((e) => e.policyRelevant).length === 0
  ) {
    conflicts.push({
      conflictType: "missing_evidence_for_distress",
      description: "Distress state is asserted but no policy-relevant evidence is attached.",
      severity: "warning",
      relatedIds: [input.activeWatchlistCaseId ?? input.activeWorkoutCaseId ?? ""],
    });
  }

  // Growth action when protection/distress is active
  if (
    input.hasGrowthWork &&
    (input.activeWorkoutCaseId || (input.hasProtectionWork && input.protectionSeverity === "critical"))
  ) {
    conflicts.push({
      conflictType: "growth_over_protection",
      description: "Growth work is flagged while critical distress or protection work is active. Growth should be suppressed.",
      severity: "warning",
      relatedIds: [input.growthCaseId ?? "", input.activeWorkoutCaseId ?? input.protectionCaseId ?? ""],
    });
  }

  return conflicts;
}
