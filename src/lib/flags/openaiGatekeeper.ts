/**
 * OpenAI Gatekeeper Feature Flags
 *
 * SINGLE SOURCE OF TRUTH for all gatekeeper-related flags.
 * No other file should read these env vars directly.
 *
 * Flags:
 * - ENABLE_OPENAI_GATEKEEPER      — batch gatekeeper in orchestrateIntake()
 * - GATEKEEPER_INLINE_ENABLED     — per-doc gatekeeper after OCR, before CLASSIFY
 * - GATEKEEPER_READINESS_ENABLED  — AI document readiness engine (informational, non-blocking)
 * - GATEKEEPER_READINESS_BLOCKS_LIFECYCLE — promote readiness to lifecycle blocker (requires READINESS_ENABLED)
 *
 * Removed (permanently enabled):
 * - GATEKEEPER_PRIMARY_ROUTING    — gatekeeper always drives routing now
 * - GATEKEEPER_SHADOW_COMPARE     — shadow comparison always runs when gatekeeper data present
 * - SLOTS_UX_ONLY                 — slots are always UX-only (never reject)
 */

/** Master gate for batch gatekeeper in orchestrateIntake(). */
export function isOpenAiGatekeeperEnabled(): boolean {
  return (
    String(process.env.ENABLE_OPENAI_GATEKEEPER ?? "").toLowerCase() === "true"
  );
}

/** Per-doc gatekeeper AWAITED after OCR, before CLASSIFY enqueue. */
export function isGatekeeperInlineEnabled(): boolean {
  return (
    String(process.env.GATEKEEPER_INLINE_ENABLED ?? "").toLowerCase() === "true"
  );
}

/** AI document readiness engine — informational, non-blocking. */
export function isGatekeeperReadinessEnabled(): boolean {
  return (
    String(process.env.GATEKEEPER_READINESS_ENABLED ?? "").toLowerCase() === "true"
  );
}

/** Promote gatekeeper readiness to lifecycle blocker. Requires GATEKEEPER_READINESS_ENABLED. */
export function isGatekeeperReadinessBlockingEnabled(): boolean {
  return (
    isGatekeeperReadinessEnabled() &&
    String(process.env.GATEKEEPER_READINESS_BLOCKS_LIFECYCLE ?? "").toLowerCase() === "true"
  );
}

/** Whether gatekeeper primary routing is active. Always true — gatekeeper is sole routing authority. */
export function isGatekeeperPrimaryRoutingEnabled(): boolean {
  return true;
}
