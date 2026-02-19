/**
 * Override Intelligence Feature Flag
 *
 * Controls whether override cluster analysis, drift detection, and golden test
 * generation are active. When OFF (default), override events still emit and
 * are persisted to deal_events — only the intelligence layer is gated.
 *
 * This is the SINGLE SOURCE OF TRUTH for the flag — no other file should
 * read ENABLE_OVERRIDE_INTELLIGENCE directly.
 *
 * Flip procedure: set ENABLE_OVERRIDE_INTELLIGENCE=true in environment, redeploy.
 */
export function isOverrideIntelligenceEnabled(): boolean {
  return String(process.env.ENABLE_OVERRIDE_INTELLIGENCE ?? "").toLowerCase() === "true";
}
