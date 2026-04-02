/**
 * System Efficiency Score — Phase 66C
 *
 * Composite system performance score measuring computational
 * efficiency and resource optimization.
 * Pure function, no DB or server deps.
 */

export type SystemEfficiencyInput = {
  recomputeSaved: number; // 0-1
  partialRefreshEffectiveness: number; // 0-1
  wastedAnalysisAvoided: number; // 0-1
  latencyImprovement: number; // 0-1
  failureRecoverySuccess: number; // 0-1
};

export type SystemEfficiencyResult = {
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: Record<string, number>;
  narrative: string;
};

const WEIGHTS: Record<keyof SystemEfficiencyInput, number> = {
  recomputeSaved: 0.20,
  partialRefreshEffectiveness: 0.20,
  wastedAnalysisAvoided: 0.20,
  latencyImprovement: 0.20,
  failureRecoverySuccess: 0.20,
};

const LABELS: Record<keyof SystemEfficiencyInput, string> = {
  recomputeSaved: "Recompute Saved",
  partialRefreshEffectiveness: "Partial Refresh Effectiveness",
  wastedAnalysisAvoided: "Wasted Analysis Avoided",
  latencyImprovement: "Latency Improvement",
  failureRecoverySuccess: "Failure Recovery Success",
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

export function computeSystemEfficiencyScore(
  input: SystemEfficiencyInput,
): SystemEfficiencyResult {
  const breakdown: Record<string, number> = {};
  let weightedSum = 0;

  for (const key of Object.keys(WEIGHTS) as Array<keyof SystemEfficiencyInput>) {
    const raw = clamp(input[key] * 100);
    breakdown[LABELS[key]] = raw;
    weightedSum += raw * WEIGHTS[key];
  }

  const score = clamp(Math.round(weightedSum));
  const grade = gradeFromScore(score);

  const dims = (Object.keys(WEIGHTS) as Array<keyof SystemEfficiencyInput>)
    .map((key) => ({ label: LABELS[key], value: clamp(input[key] * 100) }))
    .sort((a, b) => a.value - b.value);

  const weakest = dims[0];
  const strongest = dims[dims.length - 1];

  const narrative =
    grade === "A" || grade === "B"
      ? `System efficiency is strong (${grade}). ${strongest.label} performing at ${strongest.value}%.`
      : `System efficiency is ${grade}. ${weakest.label} at ${weakest.value}% is the primary bottleneck.`;

  return { score, grade, breakdown, narrative };
}
