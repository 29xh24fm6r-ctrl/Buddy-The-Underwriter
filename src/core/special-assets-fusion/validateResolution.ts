// Pure function. No DB. No side effects. No network.

/**
 * Validate that a case resolution meets all hardening requirements.
 * A case cannot resolve unless required conditions are met.
 */
export function validateResolution(input: {
  openActionItemCount: number;
  waivedActionItemCount: number;
  hasResolutionOutcome: boolean;
  hasBankerSummary: boolean;
  hasEvidenceAttached: boolean;
  isReturnToPass: boolean;
  hasPassRationale: boolean;
}): { valid: boolean; blockers: string[] } {
  const blockers: string[] = [];

  // Open items must be closed or waived
  if (input.openActionItemCount > 0) {
    blockers.push(
      `${input.openActionItemCount} open action item(s) must be completed, cancelled, or waived before resolution.`,
    );
  }

  // Resolution outcome required
  if (!input.hasResolutionOutcome) {
    blockers.push("Resolution outcome is required.");
  }

  // Banker summary required
  if (!input.hasBankerSummary) {
    blockers.push("Banker resolution summary is required.");
  }

  // Evidence required
  if (!input.hasEvidenceAttached) {
    blockers.push("At least one evidence attachment is required for resolution.");
  }

  // Return-to-pass requires explicit rationale
  if (input.isReturnToPass && !input.hasPassRationale) {
    blockers.push("Return-to-pass requires a re-underwrite or explicit pass rationale.");
  }

  return { valid: blockers.length === 0, blockers };
}
