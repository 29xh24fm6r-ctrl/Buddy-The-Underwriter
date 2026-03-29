/**
 * Phase 54 — Eval Scorer
 *
 * Fact and ratio accuracy are 100% deterministic — no LLM.
 * LLM judge is only for narrative quality (not implemented in 54 base).
 */

import type { EvalCase, EvalScore, IncorrectFact } from "./types";

const DEFAULT_TOLERANCE = 0.02; // 2%
const PASSING_THRESHOLD = 0.85;

function withinTolerance(actual: number, expected: number, tol = DEFAULT_TOLERANCE): boolean {
  if (expected === 0) return Math.abs(actual) < 1;
  return Math.abs((actual - expected) / expected) <= tol;
}

export function scoreCase(
  evalCase: EvalCase,
  actualFacts: Record<string, number | null>,
  actualValidationStatus: string | null,
): EvalScore {
  // 1. Fact accuracy
  const expectedFacts = evalCase.expectedOutputs.facts;
  const factKeys = Object.keys(expectedFacts);
  const incorrectFacts: IncorrectFact[] = [];

  for (const key of factKeys) {
    const expected = expectedFacts[key];
    const actual = actualFacts[key] ?? null;
    if (actual === null || !withinTolerance(actual, expected)) {
      incorrectFacts.push({
        key,
        expected,
        actual,
        delta: actual !== null ? Math.abs(actual - expected) : expected,
      });
    }
  }

  const factScore = factKeys.length > 0
    ? (factKeys.length - incorrectFacts.length) / factKeys.length
    : 1.0;

  // 2. Ratio accuracy
  const expectedRatios = evalCase.expectedOutputs.ratios;
  const ratioKeys = Object.keys(expectedRatios).filter(
    (k) => (expectedRatios as Record<string, number | undefined>)[k] !== undefined,
  );
  let ratioCorrect = 0;

  for (const key of ratioKeys) {
    const expected = (expectedRatios as Record<string, number>)[key];
    // Map ratio keys to fact keys
    const factKey = mapRatioToFactKey(key);
    const actual = actualFacts[factKey] ?? null;
    if (actual !== null && withinTolerance(actual, expected)) {
      ratioCorrect++;
    }
  }

  const ratioScore = ratioKeys.length > 0 ? ratioCorrect / ratioKeys.length : 1.0;

  // 3. Validation pass accuracy
  const validationAccuracy = evalCase.expectedOutputs.validationStatus && actualValidationStatus
    ? {
        expectedStatus: evalCase.expectedOutputs.validationStatus,
        actualStatus: actualValidationStatus,
        correct: evalCase.expectedOutputs.validationStatus === actualValidationStatus,
      }
    : undefined;

  // 4. Overall score (weighted: facts 50%, ratios 30%, validation 20%)
  const validationScore = validationAccuracy ? (validationAccuracy.correct ? 1.0 : 0.0) : 1.0;
  const overallScore = factScore * 0.5 + ratioScore * 0.3 + validationScore * 0.2;

  return {
    caseId: evalCase.id,
    caseName: evalCase.name,
    passed: overallScore >= PASSING_THRESHOLD,
    overallScore,
    factAccuracy: {
      total: factKeys.length,
      correct: factKeys.length - incorrectFacts.length,
      incorrect: incorrectFacts,
      score: factScore,
    },
    ratioAccuracy: {
      total: ratioKeys.length,
      correct: ratioCorrect,
      tolerancePct: DEFAULT_TOLERANCE,
      score: ratioScore,
    },
    validationPassAccuracy: validationAccuracy,
  };
}

function mapRatioToFactKey(ratioKey: string): string {
  const MAP: Record<string, string> = {
    dscr: "DSCR",
    netOperatingIncome: "NOI_TTM",
    cashFlowAfterDebtService: "EXCESS_CASH_FLOW",
    leverageRatio: "DEBT_TO_EQUITY",
  };
  return MAP[ratioKey] ?? ratioKey.toUpperCase();
}
