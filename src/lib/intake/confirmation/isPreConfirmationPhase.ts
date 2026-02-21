/**
 * Phase E1.1 — Pure Intake Phase Predicate
 *
 * Centralizes pre/post-confirmation phase detection.
 * Pure module — no server-only, no DB. Safe for CI guard imports.
 *
 * Pre-confirmation: BULK_UPLOADED, CLASSIFIED_PENDING_CONFIRMATION, null/undefined
 * Post-confirmation: CONFIRMED_READY_FOR_PROCESSING, PROCESSING_COMPLETE, PROCESSING_COMPLETE_WITH_ERRORS
 */

const POST_CONFIRMATION_PHASES = new Set([
  "CONFIRMED_READY_FOR_PROCESSING",
  "PROCESSING_COMPLETE",
  "PROCESSING_COMPLETE_WITH_ERRORS",
]);

/**
 * Returns true if the deal's intake_phase is before confirmation.
 * Fail-closed: null/undefined = pre-confirmation (unknown phase → block).
 */
export function isPreConfirmationPhase(
  phase: string | null | undefined,
): boolean {
  if (!phase) return true;
  return !POST_CONFIRMATION_PHASES.has(phase);
}

export const AUTHORITY_HARDENING_VERSION = "authority_v1.1";
