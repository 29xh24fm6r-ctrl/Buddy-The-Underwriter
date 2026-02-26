/**
 * Deterministic mapping: target phase → full update payload.
 *
 * Centralizes the field-setting contract for intake phase transitions so that
 * every caller produces a constraint-safe UPDATE payload. If the CHECK
 * constraint or lifecycle fields change, only this function needs updating.
 *
 * Pure function — no DB, no server-only imports.
 */

export type TerminalPhase =
  | "PROCESSING_COMPLETE"
  | "PROCESSING_COMPLETE_WITH_ERRORS";

/**
 * Build the UPDATE payload for transitioning a deal to a terminal phase.
 *
 * Rules:
 * - PROCESSING_COMPLETE: clears error field.
 * - PROCESSING_COMPLETE_WITH_ERRORS: sets error field (required).
 */
export function computeDealPhasePatch(
  targetPhase: TerminalPhase,
  opts: { errorSummary?: string | null },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    intake_phase: targetPhase,
  };

  if (targetPhase === "PROCESSING_COMPLETE") {
    // Success: clear any lingering error from a previous failed attempt
    patch.intake_processing_error = null;
  } else {
    // Error: always set error field
    patch.intake_processing_error =
      opts.errorSummary ?? "unknown_processing_error";
  }

  return patch;
}
