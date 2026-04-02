/**
 * Reuse Planner — Phase 66B Material Change Engine
 *
 * Pure function. Given an InvalidationPlan, determines what can be safely
 * reused from prior computations to minimise redundant work.
 */

import type { InvalidationPlan } from "./invalidationPlanner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriorComputationState {
  /** Stages that completed successfully in the prior run. */
  completedStages: string[];
  /** Age of the most recent snapshot in seconds. */
  snapshotAge: number;
  /** Total number of canonical facts persisted. */
  factCount: number;
}

export interface ReusePlan {
  /** Stages whose prior results can be carried forward. */
  reusableStages: string[];
  /** Stages that must be recomputed. */
  mustRecompute: string[];
  /** Estimated percentage of work saved by reuse (0-100). */
  estimatedSavingsPercent: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Beyond this age (seconds) we consider cached results stale regardless. */
const MAX_SNAPSHOT_AGE_SECONDS = 86_400; // 24 hours

/** Below this fact count the prior computation is too thin to reuse. */
const MIN_FACTS_FOR_REUSE = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function planReuse(
  invalidation: InvalidationPlan,
  priorState: PriorComputationState,
): ReusePlan {
  const invalidatedSet = new Set(invalidation.affectedStages);

  // If snapshot is too old or fact base too thin, nothing is reusable.
  if (
    priorState.snapshotAge > MAX_SNAPSHOT_AGE_SECONDS ||
    priorState.factCount < MIN_FACTS_FOR_REUSE
  ) {
    return {
      reusableStages: [],
      mustRecompute: [...invalidatedSet, ...priorState.completedStages.filter((s) => !invalidatedSet.has(s))],
      estimatedSavingsPercent: 0,
    };
  }

  const reusableStages: string[] = [];
  const mustRecompute: string[] = [];

  for (const stage of priorState.completedStages) {
    if (invalidatedSet.has(stage)) {
      mustRecompute.push(stage);
    } else {
      reusableStages.push(stage);
    }
  }

  // Stages that were never completed but are now invalidated still need computation.
  for (const stage of invalidation.affectedStages) {
    if (!mustRecompute.includes(stage)) {
      mustRecompute.push(stage);
    }
  }

  const totalStages = reusableStages.length + mustRecompute.length;
  const estimatedSavingsPercent =
    totalStages > 0 ? Math.round((reusableStages.length / totalStages) * 100) : 0;

  return {
    reusableStages,
    mustRecompute,
    estimatedSavingsPercent,
  };
}
