/**
 * Feature Flag — Intake Confirmation Gate (Phase E0)
 *
 * Controls whether the human confirmation gate is active.
 * When enabled, processArtifact stops after classification and defers
 * downstream processing (matching, extraction, spreads) until confirmed.
 *
 * Gate is FAIL-CLOSED:
 * - Ambiguous state blocks processing.
 * - In Production, gate is ALWAYS active. Buddy does not silently
 *   downgrade risk controls. Missing env var → critical log + forced ON.
 *
 * Set ENABLE_INTAKE_CONFIRMATION_GATE=true to activate (non-production).
 */
export function isIntakeConfirmationGateEnabled(): boolean {
  const raw = String(process.env.ENABLE_INTAKE_CONFIRMATION_GATE ?? "").toLowerCase();
  const enabled = raw === "true";

  if (!enabled && process.env.NODE_ENV === "production") {
    console.error(
      "[CRITICAL] ENABLE_INTAKE_CONFIRMATION_GATE is not set in Production. " +
        "Buddy does not silently downgrade risk controls. Gate forced ON.",
    );
    return true;
  }

  return enabled;
}
