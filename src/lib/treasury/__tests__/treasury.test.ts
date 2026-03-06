import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateTreasuryProposals } from "../treasuryProposalEngine";
import { analyzeRelationshipPricing } from "../relationshipPricingEngine";
import type { DepositProfile } from "../../deposits/depositProfileBuilder";

describe("Treasury Proposal Engine", () => {
  it("Test 5: lockbox recommended when DSO > 45 days", () => {
    const proposals = generateTreasuryProposals({
      avgDailyBalance: null,
      accountsReceivable: 150000,
      grossReceipts: 800000,
      salariesWages: null,
      depositVolatility: null,
      naicsCode: null,
    });

    const lockbox = proposals.find((p) => p.product === "LOCKBOX");
    assert.ok(lockbox);
    assert.equal(lockbox.recommended, true);
    // DSO = 150000 / (800000/365) = ~68 days
    assert.ok(lockbox.rationale.includes("DSO"));
    assert.ok(lockbox.estimatedAnnualFee > 0);
  });

  it("Test 6: lockbox NOT recommended when DSO <= 45 days", () => {
    const proposals = generateTreasuryProposals({
      avgDailyBalance: null,
      accountsReceivable: 50000,
      grossReceipts: 800000,
      salariesWages: null,
      depositVolatility: null,
      naicsCode: null,
    });

    const lockbox = proposals.find((p) => p.product === "LOCKBOX");
    assert.ok(lockbox);
    assert.equal(lockbox.recommended, false);
    // DSO = 50000 / (800000/365) = ~23 days
  });

  it("Test 7: ACH recommended when payroll > $50k", () => {
    const proposals = generateTreasuryProposals({
      avgDailyBalance: null,
      accountsReceivable: null,
      grossReceipts: null,
      salariesWages: 200000,
      depositVolatility: null,
      naicsCode: null,
    });

    const ach = proposals.find((p) => p.product === "ACH_ORIGINATION");
    assert.ok(ach);
    assert.equal(ach.recommended, true);
    assert.ok(ach.rationale.includes("payroll"));
    assert.equal(ach.estimatedAnnualFee, 600 + 200000 * 0.0005); // 700
  });

  it("Test 8: sweep recommended when avg balance > $100k", () => {
    const proposals = generateTreasuryProposals({
      avgDailyBalance: 250000,
      accountsReceivable: null,
      grossReceipts: null,
      salariesWages: null,
      depositVolatility: null,
      naicsCode: null,
    });

    const sweep = proposals.find((p) => p.product === "SWEEP_ACCOUNT");
    assert.ok(sweep);
    assert.equal(sweep.recommended, true);
    assert.equal(sweep.estimatedAnnualFee, 0); // spread, not explicit
  });
});

describe("Relationship Pricing Engine", () => {
  it("Test 9: complianceNote always present and contains Section 106", () => {
    const result = analyzeRelationshipPricing({
      loanAmount: null,
      loanSpreadBps: null,
      depositProfile: null,
      treasuryProposals: [],
    });

    assert.ok(result.complianceNote.includes("Section 106"));
    assert.ok(result.complianceNote.includes("not as a condition of credit"));
  });

  it("Test 10: deposit EC reduces implied spread cost", () => {
    const depositProfile: DepositProfile = {
      averageDailyBalance: 1000000,
      balanceVolatility: 50000,
      lowestMonthlyBalance: 800000,
      highestMonthlyBalance: 1200000,
      lowBalancePeriods: [],
      seasonalPattern: "CONSISTENT",
      depositRelationshipValue: 3000, // 1000000 * 0.003
      creditSignals: [],
    };

    const result = analyzeRelationshipPricing({
      loanAmount: 1000000,
      loanSpreadBps: 250,
      depositProfile,
      treasuryProposals: [],
    });

    // impliedLoanSpreadAdjustmentBps = floor((3000 / 1000000) * 10000) = 30 bps
    assert.equal(result.impliedLoanSpreadAdjustmentBps, 30);
    assert.equal(result.depositEarningsCreditAnnual, 3000);
    assert.ok(result.totalRelationshipValueAnnual !== null);
    // Loan spread income = 1000000 * 250 / 10000 = 25000
    // Total = 25000 + 3000 + 0 = 28000
    assert.equal(result.totalRelationshipValueAnnual, 28000);
    assert.ok(result.complianceNote.includes("Section 106"));
  });
});
