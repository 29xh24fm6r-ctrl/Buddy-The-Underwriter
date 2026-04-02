/**
 * Borrower Uplift Score — Phase 66C
 *
 * Composite borrower improvement score measuring how effectively
 * the system helps borrowers become loan-ready.
 * Pure function, no DB or server deps.
 */

export type BorrowerUpliftInput = {
  readinessImprovement: number; // 0-1
  actionCompletion: number; // 0-1
  milestoneCompletion: number; // 0-1
  reducedConfusion: number; // 0-1
  submissionQuality: number; // 0-1
  scenarioUsefulness: number; // 0-1
};

export type BorrowerUpliftResult = {
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: Record<string, number>;
  narrative: string;
};

const WEIGHTS: Record<keyof BorrowerUpliftInput, number> = {
  readinessImprovement: 0.25,
  actionCompletion: 0.20,
  milestoneCompletion: 0.20,
  reducedConfusion: 0.10,
  submissionQuality: 0.15,
  scenarioUsefulness: 0.10,
};

const LABELS: Record<keyof BorrowerUpliftInput, string> = {
  readinessImprovement: "Readiness Improvement",
  actionCompletion: "Action Completion",
  milestoneCompletion: "Milestone Completion",
  reducedConfusion: "Reduced Confusion",
  submissionQuality: "Submission Quality",
  scenarioUsefulness: "Scenario Usefulness",
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

export function computeBorrowerUpliftScore(
  input: BorrowerUpliftInput,
): BorrowerUpliftResult {
  const breakdown: Record<string, number> = {};
  let weightedSum = 0;

  for (const key of Object.keys(WEIGHTS) as Array<keyof BorrowerUpliftInput>) {
    const raw = clamp(input[key] * 100);
    breakdown[LABELS[key]] = raw;
    weightedSum += raw * WEIGHTS[key];
  }

  const score = clamp(Math.round(weightedSum));
  const grade = gradeFromScore(score);

  const dims = (Object.keys(WEIGHTS) as Array<keyof BorrowerUpliftInput>)
    .map((key) => ({ label: LABELS[key], value: clamp(input[key] * 100) }))
    .sort((a, b) => a.value - b.value);

  const weakest = dims[0];
  const strongest = dims[dims.length - 1];

  const narrative =
    grade === "A" || grade === "B"
      ? `Borrower progress is excellent (${grade}). ${strongest.label} leads at ${strongest.value}%.`
      : `Borrower progress is ${grade}. Improving ${weakest.label} (${weakest.value}%) would have the greatest impact.`;

  return { score, grade, breakdown, narrative };
}
