/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 12 tests.
 *
 * Missing financials, stale appraisal, weak DSCR, collateral shortfall — plus
 * every criticism carries evidence, and mitigants soften residual risk.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runExaminerReview, type ExaminerInput } from "@/lib/finengine/examiner";

describe("PR12 — core criticisms", () => {
  it("weak DSCR → high repayment criticism with evidence", () => {
    const r = runExaminerReview({ dscr: 1.05 });
    const c = r.criticisms.find((x) => x.code === "repayment:weak_dscr");
    assert.ok(c);
    assert.equal(c!.severity, "high");
    assert.ok(c!.evidence.some((e) => e.startsWith("dscr=")));
    assert.ok(c!.recommendedCondition.length > 0);
  });

  it("stale appraisal → moderate stale_information criticism", () => {
    const r = runExaminerReview({ appraisalAgeMonths: 20 });
    const c = r.criticisms.find((x) => x.code === "stale:appraisal");
    assert.ok(c);
    assert.equal(c!.category, "stale_information");
  });

  it("collateral shortfall → severity scales with gap", () => {
    const small = runExaminerReview({ collateralCoverage: 0.9 }).criticisms.find((c) => c.code === "collateral:shortfall");
    const big = runExaminerReview({ collateralCoverage: 0.5 }).criticisms.find((c) => c.code === "collateral:shortfall");
    assert.equal(small!.severity, "moderate");
    assert.equal(big!.severity, "high");
  });

  it("missing financials → documentation criticism, severity scales with count", () => {
    const one = runExaminerReview({ missingDocuments: ["BUSINESS_TAX_RETURN"] });
    const many = runExaminerReview({ missingDocuments: ["A", "B", "C"] });
    assert.equal(one.criticisms[0].severity, "moderate");
    assert.equal(many.criticisms[0].severity, "high");
  });
});

describe("PR12 — mitigants soften residual risk", () => {
  it("a supplied mitigant reduces residual risk one notch", () => {
    const r = runExaminerReview({
      dscr: 1.05,
      mitigants: { "repayment:weak_dscr": ["Strong guarantor global cash flow of 1.6x"] },
    });
    const c = r.criticisms.find((x) => x.code === "repayment:weak_dscr")!;
    assert.equal(c.severity, "high");
    assert.equal(c.residualRisk, "moderate"); // softened
    assert.equal(c.mitigants.length, 1);
  });

  it("no mitigant → residual equals severity", () => {
    const c = runExaminerReview({ dscr: 1.05 }).criticisms.find((x) => x.code === "repayment:weak_dscr")!;
    assert.equal(c.residualRisk, "high");
  });
});

describe("PR12 — monitoring + guarantor + policy", () => {
  it("required-but-missing borrowing base → high monitoring criticism", () => {
    const r = runExaminerReview({ monitoring: { covenantsSet: true, borrowingBaseRequired: true, borrowingBaseReceived: false } });
    assert.ok(r.criticisms.some((c) => c.code === "monitoring:missing_borrowing_base" && c.severity === "high"));
  });

  it("no guarantor → moderate guarantor criticism", () => {
    const r = runExaminerReview({ guarantor: { hasGuarantor: false } });
    assert.ok(r.criticisms.some((c) => c.code === "guarantor:none"));
  });

  it("unapproved policy exception → high", () => {
    const r = runExaminerReview({ policyExceptions: [{ policy: "ltv_over_policy", approved: false }] });
    assert.ok(r.criticisms.some((c) => c.category === "policy_exception" && c.severity === "high"));
  });
});

describe("PR12 — aggregation", () => {
  it("sorts most-severe first and counts by severity", () => {
    const input: ExaminerInput = {
      dscr: 1.05, // high
      appraisalAgeMonths: 20, // moderate
      collateralCoverage: 0.5, // high
    };
    const r = runExaminerReview(input);
    assert.equal(r.criticisms[0].severity, "high");
    assert.equal(r.highCount, 2);
    assert.equal(r.moderateCount, 1);
  });

  it("clean credit → no criticisms", () => {
    const r = runExaminerReview({ dscr: 1.5, collateralCoverage: 1.2, appraisalAgeMonths: 3 });
    assert.deepEqual(r.criticisms, []);
  });
});
