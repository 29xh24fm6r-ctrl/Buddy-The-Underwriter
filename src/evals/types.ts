/**
 * Phase 54 — Buddy Eval Suite Types
 */

export type EvalRunMode = "facts_only" | "full_pipeline";

export type EvalCase = {
  id: string;
  name: string;
  dealType: "operating_company" | "real_estate" | "mixed_use";
  facts: Record<string, number>;
  expectedOutputs: EvalExpectedOutputs;
  tags: string[];
};

export type EvalExpectedOutputs = {
  facts: Record<string, number>;
  ratios: {
    dscr?: number;
    leverageRatio?: number;
    debtYield?: number;
    netOperatingIncome?: number;
    cashFlowAfterDebtService?: number;
  };
  validationStatus?: "PASS" | "PASS_WITH_FLAGS" | "FAIL";
};

export type IncorrectFact = {
  key: string;
  expected: number;
  actual: number | null;
  delta: number;
};

export type EvalScore = {
  caseId: string;
  caseName: string;
  passed: boolean;
  overallScore: number;
  factAccuracy: {
    total: number;
    correct: number;
    incorrect: IncorrectFact[];
    score: number;
  };
  ratioAccuracy: {
    total: number;
    correct: number;
    tolerancePct: number;
    score: number;
  };
  validationPassAccuracy?: {
    expectedStatus: string;
    actualStatus: string;
    correct: boolean;
  };
};

export type EvalRunSummary = {
  runId: string;
  runAt: string;
  mode: EvalRunMode;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  overallAccuracy: number;
  durationMs: number;
  scores: EvalScore[];
};
