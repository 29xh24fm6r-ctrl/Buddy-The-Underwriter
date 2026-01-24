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
 * Check if deal has passed a minimum stage (linear progression).
 * Useful for "deal must be at least at X stage" checks.
 *
 * @example
 * const result = requireMinimumStage(state, "underwrite_in_progress", "/deals/123/cockpit");
 */
export function requireMinimumStage(
  state: LifecycleState,
  minimumStage: LifecycleStage,
  fallbackRoute: string
): GuardResult {
  const stageOrder: LifecycleStage[] = [
    "intake_created",
    "docs_requested",
    "docs_in_progress",
    "docs_satisfied",
    "underwrite_ready",
    "underwrite_in_progress",
    "committee_ready",
    "committee_decisioned",
    "closing_in_progress",
    "closed",
  ];

  const currentIndex = stageOrder.indexOf(state.stage);
  const minimumIndex = stageOrder.indexOf(minimumStage);

  // Handle workout separately (it's a branch, not in linear order)
  if (state.stage === "workout") {
    // Workout is accessible from committee_decisioned onwards
    if (minimumIndex <= stageOrder.indexOf("committee_decisioned")) {
      return { ok: true };
    }
  }

  if (currentIndex >= minimumIndex) {
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
