/**
 * Override Intelligence Feature Flag
 *
 * Controls whether override cluster analysis, drift detection, and golden test
 * generation are active. When OFF (default in non-production), override events
 * still emit and are persisted to deal_events — only the intelligence layer is gated.
 *
 * In Production, Override Intelligence is ALWAYS active. Buddy does not silently
 * downgrade risk controls. Missing env var → critical log + forced ON.
 *
 * This is the SINGLE SOURCE OF TRUTH for the flag — no other file should
 * read ENABLE_OVERRIDE_INTELLIGENCE directly.
 *
 * Flip procedure: set ENABLE_OVERRIDE_INTELLIGENCE=true in environment, redeploy.
 */
export function isOverrideIntelligenceEnabled(): boolean {
  const raw = String(process.env.ENABLE_OVERRIDE_INTELLIGENCE ?? "").toLowerCase();
  const enabled = raw === "true";

  if (!enabled && process.env.NODE_ENV === "production") {
    console.error(
      "[CRITICAL] ENABLE_OVERRIDE_INTELLIGENCE is not set in Production. " +
        "Buddy does not silently downgrade risk controls. Forced ON.",
    );
    return true;
  }

  return enabled;
}
