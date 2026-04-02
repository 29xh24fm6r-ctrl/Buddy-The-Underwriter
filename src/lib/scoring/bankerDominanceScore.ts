/**
 * Banker Dominance Score — Phase 66C
 *
 * Composite banker effectiveness score measuring how well
 * the system's recommendations serve the banker's workflow.
 * Pure function, no DB or server deps.
 */

export type BankerDominanceInput = {
  recommendationAcceptanceRate: number; // 0-1
  overrideAdjustedTrust: number; // 0-1
  memoReuseRate: number; // 0-1
  evidenceDrilldownSatisfaction: number; // 0-1
  actionUsefulness: number; // 0-1
};

export type BankerDominanceResult = {
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: Record<string, number>;
  narrative: string;
};

const WEIGHTS: Record<keyof BankerDominanceInput, number> = {
  recommendationAcceptanceRate: 0.25,
  overrideAdjustedTrust: 0.25,
  memoReuseRate: 0.15,
  evidenceDrilldownSatisfaction: 0.15,
  actionUsefulness: 0.20,
};

const LABELS: Record<keyof BankerDominanceInput, string> = {
  recommendationAcceptanceRate: "Recommendation Acceptance",
  overrideAdjustedTrust: "Override-Adjusted Trust",
  memoReuseRate: "Memo Reuse",
  evidenceDrilldownSatisfaction: "Evidence Drilldown Satisfaction",
  actionUsefulness: "Action Usefulness",
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function gradeFromScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function computeBankerDominanceScore(
  input: BankerDominanceInput,
): BankerDominanceResult {
  const breakdown: Record<string, number> = {};
  let weightedSum = 0;

  for (const key of Object.keys(WEIGHTS) as Array<keyof BankerDominanceInput>) {
    const raw = clamp(input[key] * 100);
    breakdown[LABELS[key]] = raw;
    weightedSum += raw * WEIGHTS[key];
  }

  const score = clamp(Math.round(weightedSum));
  const grade = gradeFromScore(score);

  const dims = (Object.keys(WEIGHTS) as Array<keyof BankerDominanceInput>)
    .map((key) => ({ label: LABELS[key], value: clamp(input[key] * 100) }))
    .sort((a, b) => a.value - b.value);

  const weakest = dims[0];
  const strongest = dims[dims.length - 1];

  const narrative =
    grade === "A" || grade === "B"
      ? `Banker effectiveness is strong (${grade}). Strongest area: ${strongest.label} at ${strongest.value}%.`
      : `Banker effectiveness is ${grade}. Focus on ${weakest.label} (${weakest.value}%) to improve overall score.`;

  return { score, grade, breakdown, narrative };
}
