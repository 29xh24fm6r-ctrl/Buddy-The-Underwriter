/**
 * OpenAI Gatekeeper Feature Flags
 *
 * SINGLE SOURCE OF TRUTH for all gatekeeper-related flags.
 * No other file should read these env vars directly.
 *
 * Flags:
 * - ENABLE_OPENAI_GATEKEEPER      — batch gatekeeper in orchestrateIntake()
 * - GATEKEEPER_INLINE_ENABLED     — per-doc gatekeeper after OCR, before CLASSIFY
 * - GATEKEEPER_SHADOW_COMPARE     — log slot-vs-gatekeeper routing divergence
 * - SLOTS_UX_ONLY                 — suppress slot rejection (keep routing override)
 * - GATEKEEPER_PRIMARY_ROUTING    — gatekeeper drives effectiveDocType; NEEDS_REVIEW = hard block
 * - GATEKEEPER_READINESS_ENABLED  — AI document readiness engine (informational, non-blocking)
 * - GATEKEEPER_READINESS_BLOCKS_LIFECYCLE — promote readiness to lifecycle blocker (requires READINESS_ENABLED)
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

/** Log slot-vs-gatekeeper routing divergence (doc type + engine). */
export function isGatekeeperShadowCompareEnabled(): boolean {
  return (
    String(process.env.GATEKEEPER_SHADOW_COMPARE ?? "").toLowerCase() === "true"
  );
}

/** Suppress slot rejection on type mismatch (keep routing override). */
export function isSlotsUxOnly(): boolean {
  return (
    String(process.env.SLOTS_UX_ONLY ?? "").toLowerCase() === "true"
  );
}

/** Gatekeeper drives effectiveDocType; NEEDS_REVIEW = hard block (no slot fallback). */
export function isGatekeeperPrimaryRoutingEnabled(): boolean {
  return (
    String(process.env.GATEKEEPER_PRIMARY_ROUTING ?? "").toLowerCase() === "true"
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

