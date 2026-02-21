/**
 * Buddy Institutional Confidence Calibration v1
 *
 * Pure function. No DB, no IO, no server-only, no randomness, no Date.now().
 *
 * Confidence must represent real uncertainty, not tier identity.
 * Penalties degrade confidence when evidence is ambiguous, sparse, or conflicting.
 * Audit trail preserved for institutional traceability.
 *
 * Banned: Math.random, Date.now, crypto.randomUUID, import "server-only"
 */

import type { SpineClassificationTier } from "./types";

// ---------------------------------------------------------------------------
// Constants (CI-locked in confidenceCalibrationGuard.test.ts)
// ---------------------------------------------------------------------------

/** Institutional floor — no document drops below this. */
export const CONFIDENCE_FLOOR = 0.35;

/** Credibility ceiling — no classification exceeds this. */
export const CONFIDENCE_CEILING = 0.97;

/** Band thresholds */
export const BAND_HIGH_THRESHOLD = 0.88;
export const BAND_MEDIUM_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Penalty amounts
// ---------------------------------------------------------------------------

export const PENALTY_AMBIGUITY = 0.10;
export const PENALTY_YEAR_UNCERTAINTY_NONE = 0.07;
export const PENALTY_YEAR_UNCERTAINTY_LOOSE = 0.04;
export const PENALTY_MULTI_FORM = 0.12;
export const PENALTY_LOW_TEXT_DENSITY = 0.08;

/** Text length below which low_text_density penalty applies. */
export const LOW_TEXT_DENSITY_THRESHOLD = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalibrationInput = {
  baseConfidence: number;
  spineTier: SpineClassificationTier;
  confusionCandidates: string[];
  formNumbers: string[] | null;
  detectedYears: number[];
  taxYear: number | null;
  textLength: number;
};

export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type PenaltyRecord = {
  kind: string;
  amount: number;
  reason: string;
};

export type CalibratedConfidence = {
  confidence: number;
  band: ConfidenceBand;
  penalties: PenaltyRecord[];
};

// ---------------------------------------------------------------------------
// Band derivation
// ---------------------------------------------------------------------------

export function deriveBand(confidence: number): ConfidenceBand {
  if (confidence >= BAND_HIGH_THRESHOLD) return "HIGH";
  if (confidence >= BAND_MEDIUM_THRESHOLD) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// calibrateConfidence — pure, deterministic
// ---------------------------------------------------------------------------

export function calibrateConfidence(input: CalibrationInput): CalibratedConfidence {
  const penalties: PenaltyRecord[] = [];
  let adjusted = input.baseConfidence;

  // Penalty: ambiguity — confusion candidates present
  if (input.confusionCandidates.length > 0) {
    penalties.push({
      kind: "ambiguity",
      amount: PENALTY_AMBIGUITY,
      reason: `${input.confusionCandidates.length} confusion candidate(s): ${input.confusionCandidates.join(", ")}`,
    });
    adjusted -= PENALTY_AMBIGUITY;
  }

  // Penalty: year uncertainty — mutually exclusive
  if (input.taxYear === null && input.detectedYears.length === 0) {
    penalties.push({
      kind: "year_uncertainty_none",
      amount: PENALTY_YEAR_UNCERTAINTY_NONE,
      reason: "No resolved tax year and no detected years in text",
    });
    adjusted -= PENALTY_YEAR_UNCERTAINTY_NONE;
  } else if (input.taxYear === null && input.detectedYears.length > 0) {
    penalties.push({
      kind: "year_uncertainty_loose",
      amount: PENALTY_YEAR_UNCERTAINTY_LOOSE,
      reason: `Detected years [${input.detectedYears.join(", ")}] but no resolved tax year`,
    });
    adjusted -= PENALTY_YEAR_UNCERTAINTY_LOOSE;
  }

  // Penalty: multi-form — multiple IRS forms detected
  if (input.formNumbers && input.formNumbers.length > 1) {
    penalties.push({
      kind: "multi_form",
      amount: PENALTY_MULTI_FORM,
      reason: `Multiple IRS forms detected: ${input.formNumbers.join(", ")}`,
    });
    adjusted -= PENALTY_MULTI_FORM;
  }

  // Penalty: low text density — thin OCR text
  if (input.textLength < LOW_TEXT_DENSITY_THRESHOLD) {
    penalties.push({
      kind: "low_text_density",
      amount: PENALTY_LOW_TEXT_DENSITY,
      reason: `Text length ${input.textLength} below threshold ${LOW_TEXT_DENSITY_THRESHOLD}`,
    });
    adjusted -= PENALTY_LOW_TEXT_DENSITY;
  }

  // Clamp
  const confidence = Math.max(CONFIDENCE_FLOOR, Math.min(CONFIDENCE_CEILING, adjusted));

  return {
    confidence,
    band: deriveBand(confidence),
    penalties,
  };
}
