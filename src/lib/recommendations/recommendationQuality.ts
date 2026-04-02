/**
 * Phase 66C — Recommendation Quality: Scores recommendation quality from outcome data.
 * Pure module — no server-only, no DB access.
 */

export interface QualityDimension {
  accepted: boolean;
  actedOn: boolean;
  resolvedBlocker: boolean;
  improvedQuality: boolean;
  timing: "too_early" | "on_time" | "too_late";
  bankerUseful: boolean;
  borrowerUnderstandable: boolean;
}

/**
 * Computes a 0-100 composite quality score from individual dimensions.
 *
 * Weights:
 *  - accepted: 20
 *  - actedOn: 15
 *  - resolvedBlocker: 20
 *  - improvedQuality: 15
 *  - timing (on_time=15, too_early=8, too_late=3): 15
 *  - bankerUseful: 10
 *  - borrowerUnderstandable: 5
 */
export function computeQualityScore(dims: QualityDimension): number {
  let score = 0;

  if (dims.accepted) score += 20;
  if (dims.actedOn) score += 15;
  if (dims.resolvedBlocker) score += 20;
  if (dims.improvedQuality) score += 15;

  if (dims.timing === "on_time") score += 15;
  else if (dims.timing === "too_early") score += 8;
  else score += 3;

  if (dims.bankerUseful) score += 10;
  if (dims.borrowerUnderstandable) score += 5;

  return score;
}

/**
 * Classifies a quality score into a human-readable tier.
 */
export function classifyQuality(
  score: number,
): "excellent" | "good" | "fair" | "poor" {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}
