import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCashFlowWaterfall } from "../cashFlowWaterfall";
import type { CashFlowWaterfallInput } from "../cashFlowWaterfall";

const BASE_INPUT: CashFlowWaterfallInput = {
  netIncomeBase: 200_000,
  depreciation: 50_000,
  amortization: 10_000,
  sec179Normalized: 5_000,
  bonusDepreciationNormalized: 3_000,
  interestExpense: 30_000,
  qoeNonRecurringIncomeTotal: null,
  qoeNonRecurringExpenseTotal: null,
  addbackExcessCompensation: null,
  addbackOwnerInsurance: null,
  addbackAutoPersonalUse: null,
  addbackHomeOffice: null,
  addbackPersonalTravelMeals: null,
  addbackFamilyCompensation: null,
  addbackRentNormalization: null,
  normalizedTaxProvision: null,
  maintenanceCapex: 20_000,
  annualDebtServiceTotal: 100_000,
  isPassThrough: true,
};

describe("Cash Flow Waterfall", () => {
  it("computes full waterfall correctly for pass-through", () => {
    const result = computeCashFlowWaterfall(BASE_INPUT);

    assert.equal(result.cfNetIncomeBase, 200_000);
    assert.equal(result.cfNoncashAddbacks, 68_000); // 50k + 10k + 5k + 3k
    assert.equal(result.cfInterestAddback, 30_000);
    assert.equal(result.cfEbitdaReported, 298_000); // 200k + 68k + 30k
    assert.equal(result.cfQoeAdjustment, null);
    assert.equal(result.cfEbitdaAdjusted, 298_000); // no QoE adjustment
    assert.equal(result.cfOwnerBenefitAddbacks, null);
    assert.equal(result.cfEbitdaOwnerAdjusted, 298_000);
    assert.equal(result.cfTaxProvisionNormalized, 0); // pass-through = 0
    assert.equal(result.cfMaintenanceCapex, 20_000);
    assert.equal(result.cfNcads, 278_000); // 298k - 0 - 20k
    assert.equal(result.cfAnnualDebtService, 100_000);
    assert.equal(result.cfCaads, 178_000); // 278k - 100k
    assert.ok(result.ratioDscrFinal !== null);
    assert.ok(Math.abs(result.ratioDscrFinal! - 2.78) < 0.01);
  });

  it("applies QoE adjustments", () => {
    const input: CashFlowWaterfallInput = {
      ...BASE_INPUT,
      qoeNonRecurringIncomeTotal: 50_000,
      qoeNonRecurringExpenseTotal: 10_000,
    };
    const result = computeCashFlowWaterfall(input);
    assert.equal(result.cfQoeAdjustment, -40_000); // +10k addback - 50k deduct
    assert.equal(result.cfEbitdaAdjusted, 258_000); // 298k - 40k
  });

  it("applies owner benefit addbacks", () => {
    const input: CashFlowWaterfallInput = {
      ...BASE_INPUT,
      addbackExcessCompensation: 100_000,
      addbackOwnerInsurance: 15_000,
    };
    const result = computeCashFlowWaterfall(input);
    assert.equal(result.cfOwnerBenefitAddbacks, 115_000);
    assert.equal(result.cfEbitdaOwnerAdjusted, 413_000); // 298k + 115k
  });

  it("subtracts tax provision for C-Corps", () => {
    const input: CashFlowWaterfallInput = {
      ...BASE_INPUT,
      isPassThrough: false,
      normalizedTaxProvision: 60_000,
    };
    const result = computeCashFlowWaterfall(input);
    assert.equal(result.cfTaxProvisionNormalized, 60_000);
    assert.equal(result.cfNcads, 218_000); // 298k - 60k - 20k
  });

  it("returns null DSCR when debt service is zero", () => {
    const input: CashFlowWaterfallInput = {
      ...BASE_INPUT,
      annualDebtServiceTotal: 0,
    };
    const result = computeCashFlowWaterfall(input);
    assert.equal(result.ratioDscrFinal, null);
  });

  it("returns null DSCR when debt service is null", () => {
    const input: CashFlowWaterfallInput = {
      ...BASE_INPUT,
      annualDebtServiceTotal: null,
    };
    const result = computeCashFlowWaterfall(input);
    assert.equal(result.ratioDscrFinal, null);
  });

  it("handles all null inputs gracefully", () => {
    const input: CashFlowWaterfallInput = {
      netIncomeBase: null,
      depreciation: null,
      amortization: null,
      sec179Normalized: null,
      bonusDepreciationNormalized: null,
      interestExpense: null,
      qoeNonRecurringIncomeTotal: null,
      qoeNonRecurringExpenseTotal: null,
      addbackExcessCompensation: null,
      addbackOwnerInsurance: null,
      addbackAutoPersonalUse: null,
      addbackHomeOffice: null,
      addbackPersonalTravelMeals: null,
      addbackFamilyCompensation: null,
      addbackRentNormalization: null,
      normalizedTaxProvision: null,
      maintenanceCapex: null,
      annualDebtServiceTotal: null,
      isPassThrough: true,
    };
    const result = computeCashFlowWaterfall(input);
    assert.equal(result.cfNetIncomeBase, null);
    assert.equal(result.cfNoncashAddbacks, null);
    assert.equal(result.cfNcads, null);
    assert.equal(result.ratioDscrFinal, null);
  });

  it("produces correct number of waterfall steps", () => {
    const result = computeCashFlowWaterfall(BASE_INPUT);
    assert.equal(result.steps.length, 14);
    // Verify canonical keys
    const keys = result.steps.map((s) => s.canonicalKey);
    assert.ok(keys.includes("CF_NET_INCOME_BASE"));
    assert.ok(keys.includes("CF_EBITDA_REPORTED"));
    assert.ok(keys.includes("CF_NCADS"));
    assert.ok(keys.includes("RATIO_DSCR_FINAL"));
  });
});
