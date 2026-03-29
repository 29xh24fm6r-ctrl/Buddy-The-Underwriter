// Pure. No DB. No side effects. No network.
// Guardrail policy for autonomous assist.

import type { AutonomyActionType } from "./types";

/** Actions that may auto-execute in controlled_autonomy mode */
export const ALLOWED_AUTO_EXECUTE_ACTIONS = new Set<AutonomyActionType>([
  "create_internal_task",
  "create_review_reminder",
  "schedule_internal_followup",
  "request_surface_refresh",
]);

/** Actions that always require banker approval before execution */
export const APPROVAL_REQUIRED_ACTIONS = new Set<AutonomyActionType>([
  "draft_borrower_message",
  "draft_internal_note",
  "resend_borrower_reminder",
]);

/** Maximum actions per autonomy plan */
export const MAX_ACTIONS_PER_PLAN = 5;

/** Global kill switch env var */
export const KILL_SWITCH_ENV = "BUDDY_AUTONOMY_KILL_SWITCH";

/** Feature flag env var */
export const FEATURE_FLAG_ENV = "BUDDY_AUTONOMY_ENABLED";

/**
 * Check if the global kill switch is active.
 */
export function isKillSwitchActive(): boolean {
  return process.env[KILL_SWITCH_ENV] === "true" || process.env[KILL_SWITCH_ENV] === "1";
}

/**
 * Check if autonomy feature is enabled.
 */
export function isAutonomyFeatureEnabled(): boolean {
  return process.env[FEATURE_FLAG_ENV] === "true" || process.env[FEATURE_FLAG_ENV] === "1";
}
