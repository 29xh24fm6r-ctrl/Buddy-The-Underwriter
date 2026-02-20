/**
 * Feature Flag — Intake Confirmation Gate (Phase E0)
 *
 * Controls whether the human confirmation gate is active.
 * When enabled, processArtifact stops after classification and defers
 * downstream processing (matching, extraction, spreads) until confirmed.
 *
 * Gate is FAIL-CLOSED: ambiguous state blocks processing.
 *
 * Set ENABLE_INTAKE_CONFIRMATION_GATE=true to activate.
 */
export function isIntakeConfirmationGateEnabled(): boolean {
  return (
    String(process.env.ENABLE_INTAKE_CONFIRMATION_GATE ?? "").toLowerCase() ===
    "true"
  );
}
