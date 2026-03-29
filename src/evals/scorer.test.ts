/**
 * Phase 54 — Eval Scorer Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreCase } from "./scorer";
import type { EvalCase } from "./types";

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "test",
    name: "Test Case",
    dealType: "operating_company",
    facts: { TOTAL_REVENUE: 1000000, DSCR: 1.5 },
    expectedOutputs: {
      facts: { TOTAL_REVENUE: 1000000, DSCR: 1.5 },
      ratios: { dscr: 1.5 },
      validationStatus: "PASS",
    },
    tags: [],
    ...overrides,
  };
}

describe("scoreCase", () => {
  it("perfect score when everything matches", () => {
    const score = scoreCase(
      makeCase(),
      { TOTAL_REVENUE: 1000000, DSCR: 1.5 },
      "PASS",
    );
    assert.equal(score.overallScore, 1.0);
    assert.equal(score.passed, true);
    assert.equal(score.factAccuracy.incorrect.length, 0);
  });

  it("detects incorrect facts", () => {
    const score = scoreCase(
      makeCase(),
      { TOTAL_REVENUE: 500000, DSCR: 1.5 }, // Revenue wrong
      "PASS",
    );
    assert.equal(score.factAccuracy.incorrect.length, 1);
    assert.equal(score.factAccuracy.incorrect[0].key, "TOTAL_REVENUE");
    assert.ok(score.overallScore < 1.0);
  });

  it("detects missing facts", () => {
    const score = scoreCase(
      makeCase(),
      { DSCR: 1.5 }, // TOTAL_REVENUE missing
      "PASS",
    );
    assert.equal(score.factAccuracy.incorrect.length, 1);
  });

  it("validation mismatch reduces score", () => {
    const score = scoreCase(
      makeCase(),
      { TOTAL_REVENUE: 1000000, DSCR: 1.5 },
      "FAIL", // Expected PASS
    );
    assert.ok(score.overallScore < 1.0);
    assert.equal(score.validationPassAccuracy?.correct, false);
  });

  it("deterministic: same input always same output", () => {
    const c = makeCase();
    const facts = { TOTAL_REVENUE: 1000000, DSCR: 1.5 };
    const s1 = scoreCase(c, facts, "PASS");
    const s2 = scoreCase(c, facts, "PASS");
    assert.equal(s1.overallScore, s2.overallScore);
    assert.equal(s1.factAccuracy.score, s2.factAccuracy.score);
  });

  it("within tolerance passes (2%)", () => {
    const score = scoreCase(
      makeCase(),
      { TOTAL_REVENUE: 1010000, DSCR: 1.52 }, // ~1% off
      "PASS",
    );
    assert.equal(score.factAccuracy.incorrect.length, 0);
    assert.equal(score.passed, true);
  });
});
