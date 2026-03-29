/**
 * Phase 54 — Eval Runner Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runEvalSuite } from "./runner";

describe("runEvalSuite", () => {
  it("runs all 10 golden cases", () => {
    const summary = runEvalSuite("facts_only");
    assert.equal(summary.totalCases, 10);
    assert.equal(summary.mode, "facts_only");
  });

  it("error cases are detected (bs imbalance = FAIL validation)", () => {
    const summary = runEvalSuite("facts_only");
    const bsError = summary.scores.find((s) => s.caseId === "err_bs_imbalance");
    assert.ok(bsError);
    assert.equal(bsError.validationPassAccuracy?.actualStatus, "FAIL");
    assert.equal(bsError.validationPassAccuracy?.correct, true);
  });

  it("missing data case detected as FAIL validation", () => {
    const summary = runEvalSuite("facts_only");
    const missing = summary.scores.find((s) => s.caseId === "err_missing_data");
    assert.ok(missing);
    assert.equal(missing.validationPassAccuracy?.actualStatus, "FAIL");
  });

  it("clean cases pass", () => {
    const summary = runEvalSuite("facts_only");
    const clean = summary.scores.filter((s) => s.caseId.startsWith("oc_") || s.caseId.startsWith("re_"));
    for (const s of clean) {
      assert.equal(s.passed, true, `${s.caseId} should pass`);
    }
  });

  it("edge cases get PASS_WITH_FLAGS", () => {
    const summary = runEvalSuite("facts_only");
    const highDscr = summary.scores.find((s) => s.caseId === "edge_high_dscr");
    assert.ok(highDscr);
    assert.equal(highDscr.validationPassAccuracy?.actualStatus, "PASS_WITH_FLAGS");
  });

  it("overall accuracy >= 85%", () => {
    const summary = runEvalSuite("facts_only");
    assert.ok(
      summary.overallAccuracy >= 0.85,
      `Overall accuracy ${(summary.overallAccuracy * 100).toFixed(1)}% below 85% threshold`,
    );
  });

  it("deterministic: same run produces same results", () => {
    const s1 = runEvalSuite("facts_only");
    const s2 = runEvalSuite("facts_only");
    assert.equal(s1.overallAccuracy, s2.overallAccuracy);
    assert.equal(s1.passedCases, s2.passedCases);
  });
});
