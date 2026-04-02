/* ------------------------------------------------------------------ */
/*  Evidence Density — pure computation, no DB, no IO                 */
/* ------------------------------------------------------------------ */

export type EvidenceInput = {
  factCount: number;
  sourceCount: number;
  inferenceCount: number;
  corroboratedFactCount: number;
  uniqueSourceClasses: number;
};

export type EvidenceDensityResult = {
  density: "rich" | "adequate" | "sparse" | "none";
  /** 0–100 composite score */
  score: number;
  breakdown: {
    factScore: number;
    sourceScore: number;
    diversityScore: number;
    corroborationScore: number;
  };
};

export function computeEvidenceDensity(
  input: EvidenceInput,
): EvidenceDensityResult {
  const {
    factCount,
    sourceCount,
    corroboratedFactCount,
    uniqueSourceClasses,
  } = input;

  const factScore = Math.min(factCount * 10, 25);
  const sourceScore = Math.min(sourceCount * 8, 25);
  const diversityScore = Math.min(uniqueSourceClasses * 10, 25);
  const corroborationScore = Math.min(
    (corroboratedFactCount / Math.max(factCount, 1)) * 25,
    25,
  );

  const score = factScore + sourceScore + diversityScore + corroborationScore;

  let density: EvidenceDensityResult["density"];
  if (score >= 75) density = "rich";
  else if (score >= 50) density = "adequate";
  else if (score >= 25) density = "sparse";
  else density = "none";

  return {
    density,
    score,
    breakdown: {
      factScore,
      sourceScore,
      diversityScore,
      corroborationScore,
    },
  };
}
