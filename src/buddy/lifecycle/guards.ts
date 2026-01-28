/**
 * Lifecycle Guards
 *
 * Helpers for route-level protection based on lifecycle state.
 * These compose with existing guards (verifyUnderwrite, etc.)
 * to provide unified access control.
 */

import type { LifecycleStage, LifecycleState, LifecycleBlocker } from "./model";

/**
 * Result of a guard check.
 */
export type GuardResult =
  | { ok: true }
  | { ok: false; redirect: string; blockers: LifecycleBlocker[]; currentStage: LifecycleStage };

/**
 * Check if deal is in one of the allowed stages.
 * Returns ok: true if allowed, or redirect info + blockers if not.
 *
 * @example
 * const result = requireStageOrBlock(state, ["underwrite_in_progress", "committee_ready"], "/deals/123/cockpit");
 * if (!result.ok) {
 *   redirect(result.redirect);
 * }
 */
export function requireStageOrBlock(
  state: LifecycleState,
  allowed: LifecycleStage[],
  fallbackRoute: string
): GuardResult {
  if (allowed.includes(state.stage)) {
    return { ok: true };
  }

  return {
    ok: false,
    redirect: fallbackRoute,
    blockers: state.blockers,
    currentStage: state.stage,
  };
}

/**
 * Stages reachable from each stage (inclusive of the stage itself and all stages beyond it).
 * Handles the workout branch naturally — workout is reachable from committee_decisioned
 * and earlier, but NOT from closing_in_progress or closed.
 */
export const STAGES_AT_OR_BEYOND: Record<LifecycleStage, Set<LifecycleStage>> = {
  intake_created: new Set([
    "intake_created", "docs_requested", "docs_in_progress", "docs_satisfied",
    "underwrite_ready", "underwrite_in_progress", "committee_ready",
    "committee_decisioned", "closing_in_progress", "closed", "workout",
  ]),
  docs_requested: new Set([
    "docs_requested", "docs_in_progress", "docs_satisfied",
    "underwrite_ready", "underwrite_in_progress", "committee_ready",
    "committee_decisioned", "closing_in_progress", "closed", "workout",
  ]),
  docs_in_progress: new Set([
    "docs_in_progress", "docs_satisfied",
    "underwrite_ready", "underwrite_in_progress", "committee_ready",
    "committee_decisioned", "closing_in_progress", "closed", "workout",
  ]),
  docs_satisfied: new Set([
    "docs_satisfied", "underwrite_ready", "underwrite_in_progress",
    "committee_ready", "committee_decisioned", "closing_in_progress",
    "closed", "workout",
  ]),
  underwrite_ready: new Set([
    "underwrite_ready", "underwrite_in_progress", "committee_ready",
    "committee_decisioned", "closing_in_progress", "closed", "workout",
  ]),
  underwrite_in_progress: new Set([
    "underwrite_in_progress", "committee_ready", "committee_decisioned",
    "closing_in_progress", "closed", "workout",
  ]),
  committee_ready: new Set([
    "committee_ready", "committee_decisioned", "closing_in_progress",
    "closed", "workout",
  ]),
  committee_decisioned: new Set([
    "committee_decisioned", "closing_in_progress", "closed", "workout",
  ]),
  closing_in_progress: new Set(["closing_in_progress", "closed"]),
  closed: new Set(["closed"]),
  workout: new Set(["workout"]),
};

/**
 * Check if `stage` is at or before `ceiling` in the lifecycle.
 * Returns true if advancing from `stage` could reach `ceiling`.
 * Used for stage-cap validation (e.g. force-advance max stage).
 */
export function isStageAtOrBefore(
  stage: LifecycleStage,
  ceiling: LifecycleStage
): boolean {
  if (stage === ceiling) return true;
  const reachable = STAGES_AT_OR_BEYOND[stage];
  return reachable?.has(ceiling) ?? false;
}

/**
 * Check if deal has passed a minimum stage.
 * Uses explicit reachability sets instead of linear indexOf —
 * handles the workout branch and any future branches without special-casing.
 *
 * @example
 * const result = requireMinimumStage(state, "underwrite_in_progress", "/deals/123/cockpit");
 */
export function requireMinimumStage(
  state: LifecycleState,
  minimumStage: LifecycleStage,
  fallbackRoute: string
): GuardResult {
  const reachable = STAGES_AT_OR_BEYOND[minimumStage];
  if (reachable?.has(state.stage)) {
    return { ok: true };
  }

  return {
    ok: false,
    redirect: fallbackRoute,
    blockers: state.blockers,
    currentStage: state.stage,
  };
}

/**
 * Check if deal has no critical blockers.
 * Some routes may be accessible even with blockers.
 */
export function requireNoBlockers(
  state: LifecycleState,
  fallbackRoute: string
): GuardResult {
  if (state.blockers.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    redirect: fallbackRoute,
    blockers: state.blockers,
    currentStage: state.stage,
  };
}

/**
 * Common guard configurations for specific pages.
 */
export const PageGuards = {
  /**
   * Underwrite page requires deal to be at least underwrite_ready.
   * Accessible: underwrite_ready, underwrite_in_progress, and beyond.
   */
  underwrite: (state: LifecycleState, dealId: string) =>
    requireMinimumStage(state, "underwrite_ready", `/deals/${dealId}/cockpit`),

  /**
   * Committee page requires deal to be at committee_ready or beyond.
   * NOT accessible during underwrite_in_progress - must wait for underwriting to complete.
   */
  committee: (state: LifecycleState, dealId: string) =>
    requireMinimumStage(state, "committee_ready", `/deals/${dealId}/cockpit`),

  /**
   * Decision page requires committee to be ready (same as committee).
   */
  decision: (state: LifecycleState, dealId: string) =>
    requireMinimumStage(state, "committee_ready", `/deals/${dealId}/cockpit`),

  /**
   * Closing page requires decision to be made.
   */
  closing: (state: LifecycleState, dealId: string) =>
    requireMinimumStage(state, "committee_decisioned", `/deals/${dealId}/cockpit`),
};

/**
 * Get a human-readable explanation of why a guard failed.
 */
export function getBlockerExplanation(result: GuardResult): string | null {
  if (result.ok) return null;

  if (result.blockers.length > 0) {
    return result.blockers.map((b) => b.message).join("; ");
  }

  return `Deal is currently in "${result.currentStage}" stage`;
}
