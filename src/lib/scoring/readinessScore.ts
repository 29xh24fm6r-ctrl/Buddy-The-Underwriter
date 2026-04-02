/**
 * Borrower-readiness scoring — NOT a credit decision.
 * Pure function, no DB or server deps.
 */

export type ReadinessInput = {
  financialClarity: number; // 0-100
  documentCompleteness: number; // 0-100
  cashStrength: number; // 0-100
  leveragePressure: number; // 0-100
  operationalFriction: number; // 0-100
  lenderReadiness: number; // 0-100
};

export type ReadinessGrade = "A" | "B" | "C" | "D" | "F";

export type ReadinessScoreResult = {
  score: number; // 0-100
  grade: ReadinessGrade;
  breakdown: ReadinessInput;
  primaryGap: string;
  secondaryGap: string;
  narrative: string;
};

const WEIGHTS: Record<keyof ReadinessInput, number> = {
  financialClarity: 0.2,
  documentCompleteness: 0.15,
  cashStrength: 0.25,
  leveragePressure: 0.15,
  operationalFriction: 0.1,
  lenderReadiness: 0.15,
};

const LABELS: Record<keyof ReadinessInput, string> = {
  financialClarity: "Financial Clarity",
  documentCompleteness: "Document Completeness",
  cashStrength: "Cash Strength",
  leveragePressure: "Leverage Pressure",
  operationalFriction: "Operational Friction",
  lenderReadiness: "Lender Readiness",
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function gradeFromScore(score: number): ReadinessGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function computeReadinessScore(
  input: ReadinessInput,
): ReadinessScoreResult {
  const clamped: ReadinessInput = {
    financialClarity: clamp(input.financialClarity),
    documentCompleteness: clamp(input.documentCompleteness),
    cashStrength: clamp(input.cashStrength),
    leveragePressure: clamp(input.leveragePressure),
    operationalFriction: clamp(input.operationalFriction),
    lenderReadiness: clamp(input.lenderReadiness),
  };

  const score = clamp(
    Math.round(
      clamped.financialClarity * WEIGHTS.financialClarity +
        clamped.documentCompleteness * WEIGHTS.documentCompleteness +
        clamped.cashStrength * WEIGHTS.cashStrength +
        clamped.leveragePressure * WEIGHTS.leveragePressure +
        clamped.operationalFriction * WEIGHTS.operationalFriction +
        clamped.lenderReadiness * WEIGHTS.lenderReadiness,
    ),
  );

  const grade = gradeFromScore(score);

  // Sort dimensions by score ascending to find gaps
  const dimensions = (
    Object.keys(WEIGHTS) as Array<keyof ReadinessInput>
  ).map((key) => ({ key, value: clamped[key] }));
  dimensions.sort((a, b) => a.value - b.value);

  const primaryGap = LABELS[dimensions[0].key];
  const secondaryGap = LABELS[dimensions[1].key];

  const narrative = `Your readiness is ${grade}. The primary gap is ${primaryGap} at ${dimensions[0].value}%.`;

  return {
    score,
    grade,
    breakdown: clamped,
    primaryGap,
    secondaryGap,
    narrative,
  };
}
