/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 23 tests.
 *
 * Missing GCF / collateral / covenant sections; metric mismatch; conclusion
 * support audit. No live memo behavior change (pure audit).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  auditClassicMemoAgainstContract,
  EXPECTED_MEMO_SECTIONS,
  type LegacyMemoSnapshot,
} from "@/lib/finengine/memo/classicMemoShadowAdapter";
import { assembleMemoContract, type MemoContractInputs } from "@/lib/finengine/memo/memoIntelligenceContract";
import { runExaminerReview } from "@/lib/finengine/examiner";
import { recommendCovenantPackage } from "@/lib/finengine/covenants/covenantEngine";
import { buildEvidenceBundle } from "@/lib/finengine/evidence";

function memo() {
  const inputs: MemoContractInputs = {
    product: "CI_TERM",
    keyStrengths: ["history"],
    keyConcerns: ["thin coverage"],
    evidence: buildEvidenceBundle("ok", [{ kind: "supporting", statement: "s" }]),
    dscr: 1.25,
    stressedDscr: 1.05,
    globalDscr: 1.4,
    concerns: [],
    collateralCoverage: 1.1,
    borrowingBaseAvailability: null,
    collateralShortfall: null,
    sba: null,
    criticisms: runExaminerReview({ dscr: 1.1 }).criticisms,
    covenantPackage: recommendCovenantPackage({ product: "CI_TERM", riskLevel: "moderate", underwrittenDscr: 1.4 }),
  };
  return assembleMemoContract(inputs);
}

const fullLegacy: LegacyMemoSnapshot = {
  sections: [...EXPECTED_MEMO_SECTIONS],
  metrics: { dscr: 1.25, globalDscr: 1.4, collateralCoverage: 1.1 },
};

describe("PR23 — clean comparison", () => {
  it("no missing sections + matching metrics → ok", () => {
    const audit = auditClassicMemoAgainstContract(fullLegacy, memo());
    assert.deepEqual(audit.missingSections, []);
    assert.deepEqual(audit.metricMismatches, []);
    assert.equal(audit.ok, true);
  });
});

describe("PR23 — missing-section detector", () => {
  it("detects a missing GLOBAL_CASH_FLOW section", () => {
    const legacy = { ...fullLegacy, sections: fullLegacy.sections.filter((s) => s !== "GLOBAL_CASH_FLOW") };
    const audit = auditClassicMemoAgainstContract(legacy, memo());
    assert.ok(audit.missingSections.includes("GLOBAL_CASH_FLOW"));
    assert.equal(audit.ok, false);
  });

  it("detects a missing COLLATERAL section", () => {
    const legacy = { ...fullLegacy, sections: fullLegacy.sections.filter((s) => s !== "COLLATERAL") };
    assert.ok(auditClassicMemoAgainstContract(legacy, memo()).missingSections.includes("COLLATERAL"));
  });

  it("detects a missing COVENANTS section", () => {
    const legacy = { ...fullLegacy, sections: fullLegacy.sections.filter((s) => s !== "COVENANTS") };
    assert.ok(auditClassicMemoAgainstContract(legacy, memo()).missingSections.includes("COVENANTS"));
  });

  it("normalizes legacy section names (e.g. 'Global Cash Flow')", () => {
    const legacy = {
      ...fullLegacy,
      sections: ["Executive Summary", "Repayment Analysis", "Global Cash Flow", "Collateral", "Examiner Concerns", "Covenants", "Approval Conditions"],
    };
    assert.deepEqual(auditClassicMemoAgainstContract(legacy, memo()).missingSections, []);
  });
});

describe("PR23 — metric mismatch detector", () => {
  it("flags a DSCR mismatch beyond tolerance", () => {
    const legacy = { ...fullLegacy, metrics: { dscr: 1.5, globalDscr: 1.4, collateralCoverage: 1.1 } };
    const audit = auditClassicMemoAgainstContract(legacy, memo());
    assert.ok(audit.metricMismatches.some((m) => m.metric === "dscr"));
    assert.equal(audit.ok, false);
  });

  it("ignores a metric absent on one side", () => {
    const legacy = { ...fullLegacy, metrics: { globalDscr: 1.4, collateralCoverage: 1.1 } }; // no dscr
    assert.ok(!auditClassicMemoAgainstContract(legacy, memo()).metricMismatches.some((m) => m.metric === "dscr"));
  });
});

describe("PR23 — conclusion support audit", () => {
  it("a certified contract supports all conclusions", () => {
    const legacy = { ...fullLegacy, conclusions: ["Recommend approval subject to conditions"] };
    assert.deepEqual(auditClassicMemoAgainstContract(legacy, memo()).unsupportedConclusions, []);
  });

  it("an uncertified contract flags conclusions as unsupported", () => {
    const m = memo();
    (m as any).certified = false;
    const legacy = { ...fullLegacy, conclusions: ["Recommend approval"] };
    assert.deepEqual(auditClassicMemoAgainstContract(legacy, m).unsupportedConclusions, ["Recommend approval"]);
  });
});
