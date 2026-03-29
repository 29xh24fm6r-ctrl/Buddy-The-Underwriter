/**
 * Phase 54 — Eval Runner
 *
 * Orchestrates golden cases through validation and scoring.
 * facts_only mode: seeds facts directly, runs BVP + scoring. Fast, deterministic.
 */

import { GOLDEN_CASES } from "./cases/goldenCases";
import { scoreCase } from "./scorer";
import { runMathematicalChecks } from "@/lib/validation/mathematicalChecks";
import { runCompletenessChecks } from "@/lib/validation/completenessChecks";
import { runPlausibilityChecks } from "@/lib/validation/plausibilityChecks";
import type { EvalRunSummary, EvalScore, EvalRunMode } from "./types";
import type { ValidationCheck } from "@/lib/validation/validationTypes";

export function runEvalSuite(mode: EvalRunMode = "facts_only"): EvalRunSummary {
  const startTime = Date.now();
  const scores: EvalScore[] = [];

  for (const evalCase of GOLDEN_CASES) {
    // In facts_only mode, use the case facts directly
    const actualFacts: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(evalCase.facts)) {
      actualFacts[k] = v;
    }

    // Run BVP checks locally (no DB, pure functions)
    const dealType = evalCase.dealType === "mixed_use" ? "mixed" : evalCase.dealType;
    const checks: ValidationCheck[] = [
      ...runCompletenessChecks(actualFacts, dealType),
      ...runMathematicalChecks(actualFacts),
      ...runPlausibilityChecks(actualFacts),
    ];

    const blockCount = checks.filter((c) => c.status === "BLOCK").length;
    const flagCount = checks.filter((c) => c.status === "FLAG").length;
    const validationStatus = blockCount > 0 ? "FAIL" : flagCount > 0 ? "PASS_WITH_FLAGS" : "PASS";

    const score = scoreCase(evalCase, actualFacts, validationStatus);
    scores.push(score);
  }

  const passedCases = scores.filter((s) => s.passed).length;
  const overallAccuracy = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length
    : 0;

  return {
    runId: crypto.randomUUID(),
    runAt: new Date().toISOString(),
    mode,
    totalCases: scores.length,
    passedCases,
    failedCases: scores.length - passedCases,
    overallAccuracy,
    durationMs: Date.now() - startTime,
    scores,
  };
}
