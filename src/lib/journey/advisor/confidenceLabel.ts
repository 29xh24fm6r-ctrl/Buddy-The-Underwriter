/**
 * SPEC-12.1 — Confidence label mapping.
 *
 * Pure functions. No side effects.
 *
 * Non-negotiable #4: Confidence label for risk-scored signals is derived
 * from SCORE via mapScoreToConfidence(). The legacy decimal stays for
 * non-risk signals (decimalToConfidenceLabel) and for the debug overlay.
 */

export type ConfidenceLabel =
  | "Very high confidence"
  | "High confidence"
  | "Moderate confidence"
  | "Low confidence";

export interface ScoreConfidenceMapping {
  label: ConfidenceLabel;
  numeric: number;
}

/**
 * Map a risk score (0–N integer) to a confidence label.
 * Higher score = more risk = LOWER confidence in committee success.
 * So score >= 70 (critical risk) maps to LOW confidence, not high.
 *
 * Wait — re-reading SPEC-12.1: the mapping is:
 *   score >= 70 → "Very high confidence" (0.95)
 * This means the SCORE reflects the model's confidence in its risk
 * assessment, not the committee's chance of passing. A high score means
 * "we are very confident this deal has committee risk."
 */
export function mapScoreToConfidence(score: number): ScoreConfidenceMapping {
  if (score >= 70) return { label: "Very high confidence", numeric: 0.95 };
  if (score >= 50) return { label: "High confidence", numeric: 0.85 };
  if (score >= 30) return { label: "Moderate confidence", numeric: 0.75 };
  return { label: "Low confidence", numeric: 0.6 };
}

/**
 * Map a source-attribution decimal (0–1) to a confidence label.
 * Used for non-risk signals that don't have a computed risk score.
 */
export function decimalToConfidenceLabel(c: number): ConfidenceLabel {
  if (c >= 0.9) return "Very high confidence";
  if (c >= 0.8) return "High confidence";
  if (c >= 0.7) return "Moderate confidence";
  return "Low confidence";
}

/**
 * Single resolver — pick the right label for any signal.
 * Risk-scored signals (those with riskScore present) use the score-based mapping.
 * Non-risk signals fall back to the source-attribution decimal.
 */
export function resolveConfidenceLabel(args: {
  riskScore?: number;
  decimalConfidence: number;
}): ConfidenceLabel {
  if (typeof args.riskScore === "number") {
    return mapScoreToConfidence(args.riskScore).label;
  }
  return decimalToConfidenceLabel(args.decimalConfidence);
}
