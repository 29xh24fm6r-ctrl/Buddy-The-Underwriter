/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 22 tests.
 *
 * The contract compiles and assembles from engine outputs; the memo object
 * contains ONLY certified outputs (every support tagged, approval conditions
 * derived from certified sources, not prose).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assembleMemoContract, validateMemoCertified, type MemoContractInputs } from "@/lib/finengine/memo/memoIntelligenceContract";
import { runExaminerReview } from "@/lib/finengine/examiner";
import { recommendCovenantPackage } from "@/lib/finengine/covenants/covenantEngine";
import { detectConcerns } from "@/lib/finengine/officer";
import { buildEvidenceBundle } from "@/lib/finengine/evidence";

function inputs(): MemoContractInputs {
  const criticisms = runExaminerReview({ dscr: 1.1, collateralCoverage: 0.8 }).criticisms;
  const covenantPackage = recommendCovenantPackage({ product: "CI_TERM", riskLevel: "moderate", underwrittenDscr: 1.35 });
  const concerns = detectConcerns({ dscr: 1.1, dscrPriorYear: 1.4 });
  const evidence = buildEvidenceBundle("Repayment adequate on cushioned basis", [
    { kind: "supporting", statement: "GCF DSCR 1.35x certified" },
  ]);
  return {
    product: "CI_TERM",
    keyStrengths: ["Established operating history"],
    keyConcerns: ["Thin coverage"],
    evidence,
    dscr: 1.1,
    stressedDscr: 0.95,
    globalDscr: 1.35,
    concerns,
    collateralCoverage: 0.8,
    borrowingBaseAvailability: null,
    collateralShortfall: 200_000,
    sba: null,
    criticisms,
    covenantPackage,
  };
}

describe("PR22 — contract assembly", () => {
  const memo = assembleMemoContract(inputs());

  it("assembles all support objects from engine outputs", () => {
    assert.equal(memo.execSummary.product, "CI_TERM");
    assert.ok(memo.repayment.concerns.length >= 0);
    assert.ok(memo.examiner.criticisms.length > 0);
    assert.ok(memo.covenants.package.length > 0);
    assert.equal(memo.certified, true);
  });

  it("approval conditions are DERIVED from certified examiner + covenant sources (not prose)", () => {
    // Every condition should trace to an examiner recommendedCondition or a covenant.
    const examinerConds = new Set(memo.examiner.criticisms.map((c) => c.recommendedCondition));
    const covenantConds = new Set(memo.covenants.package.filter((c) => c.kind !== "financial").map((c) => `${c.type}: ${c.rationale}`));
    for (const cond of memo.approvalConditions.conditions) {
      assert.ok(examinerConds.has(cond) || covenantConds.has(cond), `condition not from certified source: ${cond}`);
    }
  });
});

describe("PR22 — certification validation", () => {
  it("a fully-assembled memo validates as certified", () => {
    const v = validateMemoCertified(assembleMemoContract(inputs()));
    assert.equal(v.certified, true);
    assert.deepEqual(v.violations, []);
  });

  it("a tampered source engine is caught", () => {
    const memo = assembleMemoContract(inputs());
    // Simulate prose injection: an unrecognized source engine.
    (memo.repayment as any).sourceEngine = "prose_guess";
    const v = validateMemoCertified(memo);
    assert.equal(v.certified, false);
    assert.ok(v.violations.some((x) => x.includes("repayment")));
  });

  it("a missing certified marker is caught", () => {
    const memo = assembleMemoContract(inputs());
    (memo as any).certified = false;
    assert.equal(validateMemoCertified(memo).certified, false);
  });
});
