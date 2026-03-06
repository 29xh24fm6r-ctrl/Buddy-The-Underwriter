import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGuarantorRatios,
  type GuarantorRatioInput,
} from "../guarantorRatios";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyInput: GuarantorRatioInput = {
  totalPersonalAssets: null,
  totalPersonalLiabilities: null,
  liquidAssets: null,
  contingentLiabilities: null,
  proposedLoanAmount: null,
  downPayment: null,
  closingCosts: null,
  totalPersonalIncome: null,
  businessCashFlow: null,
  totalPersonalDebtService: null,
  totalDebtService: null,
  monthlyDebtPayments: null,
  grossMonthlyIncome: null,
  k1Items: [],
  w2Year1: null,
  w2Year2: null,
  seIncomeYear1: null,
  seIncomeYear2: null,
};

function withInput(overrides: Partial<GuarantorRatioInput>): GuarantorRatioInput {
  return { ...emptyInput, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Guarantor Ratios — computeGuarantorRatios", () => {
  // ── Personal Net Worth ──────────────────────────────────────────────────

  it("computes personal net worth = assets − liabilities", () => {
    const result = computeGuarantorRatios(
      withInput({ totalPersonalAssets: 1_500_000, totalPersonalLiabilities: 600_000 }),
    );
    assert.equal(result.personalNetWorth, 900_000);
  });

  it("returns null net worth when assets missing", () => {
    const result = computeGuarantorRatios(
      withInput({ totalPersonalLiabilities: 600_000 }),
    );
    assert.equal(result.personalNetWorth, null);
  });

  // ── Personal Liquidity % ────────────────────────────────────────────────

  it("computes personal liquidity pct", () => {
    const result = computeGuarantorRatios(
      withInput({ liquidAssets: 300_000, proposedLoanAmount: 1_000_000 }),
    );
    assert.equal(result.personalLiquidityPct, 30);
  });

  it("returns null liquidity when loan amount is zero", () => {
    const result = computeGuarantorRatios(
      withInput({ liquidAssets: 300_000, proposedLoanAmount: 0 }),
    );
    assert.equal(result.personalLiquidityPct, null);
  });

  // ── Personal DSCR ──────────────────────────────────────────────────────

  it("computes personal DSCR", () => {
    const result = computeGuarantorRatios(
      withInput({ totalPersonalIncome: 200_000, totalPersonalDebtService: 150_000 }),
    );
    assert.ok(result.personalDscr !== null);
    assert.ok(Math.abs(result.personalDscr! - 1.333) < 0.01);
  });

  // ── Global DSCR ────────────────────────────────────────────────────────

  it("computes global DSCR = (business + personal) / total debt service", () => {
    const result = computeGuarantorRatios(
      withInput({
        businessCashFlow: 500_000,
        totalPersonalIncome: 100_000,
        totalDebtService: 400_000,
      }),
    );
    assert.equal(result.globalDscr, 1.5);
  });

  it("computes global DSCR with only business cash flow", () => {
    const result = computeGuarantorRatios(
      withInput({
        businessCashFlow: 400_000,
        totalDebtService: 400_000,
      }),
    );
    assert.equal(result.globalDscr, 1.0);
  });

  // ── Contingent Liabilities ─────────────────────────────────────────────

  it("passes through contingent liabilities", () => {
    const result = computeGuarantorRatios(
      withInput({ contingentLiabilities: 250_000 }),
    );
    assert.equal(result.contingentLiabilitiesTotal, 250_000);
  });

  // ── K-1 Aggregate Income ───────────────────────────────────────────────

  it("computes K-1 aggregate income weighted by ownership", () => {
    const result = computeGuarantorRatios(
      withInput({
        k1Items: [
          { ordinaryIncome: 200_000, ownershipPct: 50 },
          { ordinaryIncome: 100_000, ownershipPct: 25 },
        ],
      }),
    );
    // 200k * 50% + 100k * 25% = 100k + 25k = 125k
    assert.equal(result.k1AggregateIncome, 125_000);
  });

  it("returns null K-1 aggregate when no items", () => {
    const result = computeGuarantorRatios(withInput({}));
    assert.equal(result.k1AggregateIncome, null);
  });

  // ── W-2 Two-Year Average ───────────────────────────────────────────────

  it("computes W-2 two-year average", () => {
    const result = computeGuarantorRatios(
      withInput({ w2Year1: 120_000, w2Year2: 110_000 }),
    );
    assert.equal(result.w2TwoYearAvg, 115_000);
  });

  it("returns single year W-2 when only one year available", () => {
    const result = computeGuarantorRatios(
      withInput({ w2Year1: 120_000 }),
    );
    assert.equal(result.w2TwoYearAvg, 120_000);
  });

  it("returns null W-2 avg when no data", () => {
    const result = computeGuarantorRatios(withInput({}));
    assert.equal(result.w2TwoYearAvg, null);
  });

  // ── SE Income Two-Year Average ─────────────────────────────────────────

  it("computes SE income 2yr avg when consistent or increasing", () => {
    const result = computeGuarantorRatios(
      withInput({ seIncomeYear1: 90_000, seIncomeYear2: 80_000 }),
    );
    // Increasing: (90k + 80k) / 2 = 85k
    assert.equal(result.seIncomeTwoYearAvg, 85_000);
  });

  it("uses current year only when SE income is declining (spec 7B)", () => {
    const result = computeGuarantorRatios(
      withInput({ seIncomeYear1: 70_000, seIncomeYear2: 90_000 }),
    );
    // Declining: year1 (70k) < year2 (90k) → use current year only
    assert.equal(result.seIncomeTwoYearAvg, 70_000);
  });

  it("returns SE income single year when only one year available", () => {
    const result = computeGuarantorRatios(
      withInput({ seIncomeYear1: 80_000 }),
    );
    assert.equal(result.seIncomeTwoYearAvg, 80_000);
  });

  // ── Personal DTI % ─────────────────────────────────────────────────────

  it("computes personal DTI %", () => {
    const result = computeGuarantorRatios(
      withInput({ monthlyDebtPayments: 3_000, grossMonthlyIncome: 10_000 }),
    );
    assert.equal(result.personalDtiPct, 30);
  });

  // ── Post-Close Liquidity ───────────────────────────────────────────────

  it("computes post-close liquidity", () => {
    const result = computeGuarantorRatios(
      withInput({ liquidAssets: 500_000, downPayment: 200_000, closingCosts: 15_000 }),
    );
    assert.equal(result.postCloseLiquidity, 285_000);
  });

  it("computes post-close liquidity with missing down payment", () => {
    const result = computeGuarantorRatios(
      withInput({ liquidAssets: 500_000, closingCosts: 15_000 }),
    );
    // downPayment defaults to 0
    assert.equal(result.postCloseLiquidity, 485_000);
  });

  it("returns null post-close liquidity when liquid assets missing", () => {
    const result = computeGuarantorRatios(
      withInput({ downPayment: 200_000, closingCosts: 15_000 }),
    );
    assert.equal(result.postCloseLiquidity, null);
  });

  // ── All nulls ──────────────────────────────────────────────────────────

  it("returns all null for empty input", () => {
    const result = computeGuarantorRatios(emptyInput);
    assert.equal(result.personalNetWorth, null);
    assert.equal(result.personalLiquidityPct, null);
    assert.equal(result.personalDscr, null);
    assert.equal(result.globalDscr, null);
    assert.equal(result.contingentLiabilitiesTotal, null);
    assert.equal(result.k1AggregateIncome, null);
    assert.equal(result.w2TwoYearAvg, null);
    assert.equal(result.seIncomeTwoYearAvg, null);
    assert.equal(result.personalDtiPct, null);
    assert.equal(result.postCloseLiquidity, null);
  });
});
