import type { ComponentScore, SubFactorScore } from "../types";

/**
 * Compute a component's raw score from its sub-factors:
 *   - Weights of null-valued sub-factors are excluded (re-normalization).
 *   - If >50% of the nominal weight is missing, `insufficientData = true`.
 *   - Returned rawScore is on the 0–5 scale.
 */
export function finalizeComponent(args: {
  componentName: string;
  weight: number; // component weight (0–1)
  subFactors: SubFactorScore[];
  narrative: string;
}): ComponentScore {
  const { componentName, weight, subFactors, narrative } = args;

  const totalWeight = subFactors.reduce((s, sf) => s + sf.weight, 0);
  const available = subFactors.filter((sf) => sf.rawScore != null);
  const availableWeight = available.reduce((s, sf) => s + sf.weight, 0);

  const missingInputs = subFactors
    .filter((sf) => sf.rawScore == null)
    .map((sf) => sf.name);

  const missingWeightPct = totalWeight > 0
    ? 1 - availableWeight / totalWeight
    : 1;

  const insufficientData = missingWeightPct > 0.5;

  let rawScore = 0;
  if (availableWeight > 0) {
    // Re-normalize: sum of (score * weight / availableWeight).
    rawScore = available.reduce(
      (sum, sf) => sum + (sf.rawScore as number) * (sf.weight / availableWeight),
      0,
    );
  }

  const contribution = rawScore * weight * 20; // 0–5 on 0–100

  return {
    componentName,
    rawScore,
    weight,
    contribution,
    subFactors,
    narrative,
    missingInputs,
    insufficientData,
  };
}
