/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 10 tests.
 *
 * Covers underfunded budget (out of balance) and insufficient contingency, plus
 * interest-reserve adequacy, completion guaranty, permits, and cost-overrun stress.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { analyzeConstructionLoan, type ConstructionInput } from "@/lib/finengine/construction";

const balanced: ConstructionInput = {
  sources: [
    { label: "Bank Loan", amount: 7_500_000 },
    { label: "Sponsor Equity", amount: 2_500_000 },
  ],
  uses: [
    { label: "Land", amount: 2_000_000 },
    { label: "Hard Costs", amount: 6_000_000 },
    { label: "Soft Costs", amount: 1_000_000 },
    { label: "Contingency", amount: 600_000 },
    { label: "Interest Reserve", amount: 400_000 },
  ],
  loanAmount: 7_500_000,
  equityAmount: 2_500_000,
  hardCosts: 6_000_000,
  softCosts: 1_000_000,
  contingency: 600_000, // 10% of hard costs
  interestReserve: 400_000,
  projectedInterestCost: 380_000,
  retainagePct: 0.1,
  completionGuarantyProvided: true,
  permits: [{ name: "building_permit", obtained: true }],
  drawSchedule: [{ month: 1, amount: 1_000_000 }],
  costOverrunStressPct: 0.05,
};

describe("PR10 — balanced, adequate deal", () => {
  const a = analyzeConstructionLoan(balanced);
  it("is in balance", () => {
    assert.equal(a.inBalance, true);
    assert.equal(a.imbalance, 0);
  });
  it("LTC and equity% computed", () => {
    assert.ok(Math.abs(a.ltc! - 7_500_000 / 10_000_000) < 1e-9);
    assert.ok(Math.abs(a.equityPct! - 0.25) < 1e-9);
  });
  it("contingency adequate, interest reserve adequate, no blockers", () => {
    assert.equal(a.contingencyAdequate, true);
    assert.equal(a.interestReserveAdequate, true);
    assert.deepEqual(a.blockers, []);
  });
  it("cost overrun absorbed by contingency (no shortfall)", () => {
    assert.equal(a.costOverrunStress?.fundingShortfall, 0);
  });
});

describe("PR10 — underfunded budget (out of balance)", () => {
  it("flags sources_and_uses_underfunded", () => {
    const a = analyzeConstructionLoan({
      ...balanced,
      sources: [{ label: "Bank Loan", amount: 7_500_000 }], // no equity → underfunded
    });
    assert.equal(a.inBalance, false);
    assert.ok(a.imbalance < 0);
    assert.ok(a.blockers.includes("sources_and_uses_underfunded"));
  });
});

describe("PR10 — insufficient contingency", () => {
  it("flags insufficient_contingency + approval condition", () => {
    const a = analyzeConstructionLoan({
      ...balanced,
      contingency: 120_000, // 2% of hard costs < 5% floor
      uses: [
        { label: "Land", amount: 2_000_000 },
        { label: "Hard Costs", amount: 6_000_000 },
        { label: "Soft Costs", amount: 1_000_000 },
        { label: "Contingency", amount: 120_000 },
        { label: "Interest Reserve", amount: 400_000 },
      ],
      sources: [
        { label: "Bank Loan", amount: 7_500_000 },
        { label: "Sponsor Equity", amount: 2_020_000 },
      ],
      loanAmount: 7_500_000,
      equityAmount: 2_020_000,
    });
    assert.equal(a.contingencyAdequate, false);
    assert.ok(a.blockers.includes("insufficient_contingency"));
    assert.ok(a.approvalConditions.some((c) => c.includes("contingency")));
  });
});

describe("PR10 — interest reserve, guaranty, permits, overrun shortfall", () => {
  it("flags insufficient interest reserve", () => {
    const a = analyzeConstructionLoan({ ...balanced, interestReserve: 100_000, projectedInterestCost: 380_000 });
    assert.equal(a.interestReserveAdequate, false);
    assert.ok(a.blockers.includes("insufficient_interest_reserve"));
  });

  it("requires completion guaranty when equity thin and not provided", () => {
    const a = analyzeConstructionLoan({
      ...balanced,
      equityAmount: 1_000_000, // 10% equity < 25% threshold
      completionGuarantyProvided: false,
    });
    assert.equal(a.completionGuarantyRequired, true);
    assert.equal(a.completionGuarantySatisfied, false);
    assert.ok(a.approvalConditions.some((c) => c.toLowerCase().includes("completion guaranty")));
  });

  it("lists missing permits", () => {
    const a = analyzeConstructionLoan({
      ...balanced,
      permits: [{ name: "building_permit", obtained: false }, { name: "grading_permit", obtained: true }],
    });
    assert.deepEqual(a.missingPermits, ["building_permit"]);
  });

  it("cost overrun beyond contingency produces a shortfall + stressed LTC", () => {
    const a = analyzeConstructionLoan({ ...balanced, contingency: 100_000, costOverrunStressPct: 0.1 });
    // overrun = 600k, contingency 100k → shortfall 500k.
    assert.equal(a.costOverrunStress?.overrunAmount, 600_000);
    assert.equal(a.costOverrunStress?.fundingShortfall, 500_000);
    assert.ok(a.costOverrunStress!.stressedLtc! < a.ltc!);
  });
});
