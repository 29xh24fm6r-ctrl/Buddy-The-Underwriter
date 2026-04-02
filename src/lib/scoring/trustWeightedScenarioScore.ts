/**
 * Scores scenarios weighted by trust/evidence quality.
 * Pure function, no DB or server deps.
 */

export type ScenarioScoreInput = {
  plausibility: number; // 0-1
  evidenceSupport: number; // 0-1
  sensitivity: number; // 0-1
  borrowerComprehensibility: number; // 0-1
  trustConfidence: "high" | "medium" | "low" | "insufficient";
};

export type TrustTier =
  | "reliable"
  | "indicative"
  | "speculative"
  | "unreliable";

export type TrustWeightedResult = {
  rawScore: number; // 0-100
  trustWeight: number; // 0-1
  adjustedScore: number; // 0-100
  tier: TrustTier;
  explanation: string;
};

const TRUST_WEIGHTS: Record<ScenarioScoreInput["trustConfidence"], number> = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
  insufficient: 0.25,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function tierFromAdjustedScore(adjustedScore: number): TrustTier {
  if (adjustedScore >= 75) return "reliable";
  if (adjustedScore >= 50) return "indicative";
  if (adjustedScore >= 25) return "speculative";
  return "unreliable";
}

function buildExplanation(
  input: ScenarioScoreInput,
  rawScore: number,
  adjustedScore: number,
  tier: TrustTier,
): string {
  const tierDescriptions: Record<TrustTier, string> = {
    reliable: "This scenario is well-supported by evidence and can inform decisions directly.",
    indicative: "This scenario is directionally useful but warrants additional validation.",
    speculative: "This scenario lacks sufficient evidence and should be treated as exploratory.",
    unreliable: "This scenario has insufficient support to inform decisions.",
  };

  const discount = rawScore - adjustedScore;
  const discountNote =
    discount > 0
      ? ` Trust confidence (${input.trustConfidence}) reduced the effective score by ${Math.round(discount)} points.`
      : "";

  return `${tierDescriptions[tier]}${discountNote}`;
}

export function computeTrustWeightedScore(
  input: ScenarioScoreInput,
): TrustWeightedResult {
  const p = clamp(input.plausibility, 0, 1);
  const e = clamp(input.evidenceSupport, 0, 1);
  const s = clamp(input.sensitivity, 0, 1);
  const b = clamp(input.borrowerComprehensibility, 0, 1);

  const trustWeight = TRUST_WEIGHTS[input.trustConfidence];

  const rawScore = clamp(
    Math.round((p * 30 + e * 30 + (1 - s) * 20 + b * 20) * 100),
    0,
    100,
  );

  const adjustedScore = clamp(Math.round(rawScore * trustWeight), 0, 100);

  const tier = tierFromAdjustedScore(adjustedScore);
  const explanation = buildExplanation(input, rawScore, adjustedScore, tier);

  return {
    rawScore,
    trustWeight,
    adjustedScore,
    tier,
    explanation,
  };
}
