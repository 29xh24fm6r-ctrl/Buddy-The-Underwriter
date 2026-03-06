import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGlobalCashFlow,
  type GlobalCashFlowInput,
} from "../globalCashFlow";

// ---------------------------------------------------------------------------
// Basic waterfall
// ---------------------------------------------------------------------------

describe("computeGlobalCashFlow — basic waterfall", () => {
  it("computes full waterfall with all components", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: 500_000,
      personalIncome: [
        { source: "W-2", annualAmount: 100_000, isRecurring: true, excludeIfInScope: false },
        { source: "Social Security", annualAmount: 24_000, isRecurring: true, excludeIfInScope: false },
      ],
      k1Exclusions: [],
      businessDebtService: [
        { description: "Term Loan", annualAmount: 120_000 },
      ],
      personalDebtService: [
        { description: "Mortgage", annualAmount: 36_000 },
      ],
      proposedDebtService: 80_000,
    };

    const result = computeGlobalCashFlow(input);

    assert.equal(result.consolidatedBusinessNcads, 500_000);
    assert.equal(result.personalIncomeGross, 124_000);
    assert.equal(result.personalIncomeExcluded, 0);
    assert.equal(result.personalIncomeNet, 124_000);
    assert.equal(result.personalLivingExpense, 36_000); // default
    assert.equal(result.netPersonalCashFlow, 88_000); // 124K - 36K
    assert.equal(result.grossGlobalCashFlow, 588_000); // 500K + 88K
    assert.equal(result.totalBusinessDebtService, 120_000);
    assert.equal(result.totalPersonalDebtService, 36_000);
    assert.equal(result.proposedDebtService, 80_000);
    assert.equal(result.globalDebtService, 236_000); // 120K + 36K + 80K
    assert.equal(result.netCashAfterAllObligations, 352_000); // 588K - 236K
    assert.ok(result.globalDscr !== null);
    assert.ok(Math.abs(result.globalDscr! - 588_000 / 236_000) < 0.01);
  });

  it("produces 8 steps in the waterfall", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: 300_000,
      personalIncome: [],
      k1Exclusions: [],
      businessDebtService: [],
      personalDebtService: [],
      proposedDebtService: 50_000,
    };
    const result = computeGlobalCashFlow(input);
    // Steps: 1, 2, 2.5, 3, 3.5, 4, 5, 5.5, 6, 6.5, 7, 8 = 12 steps
    assert.equal(result.steps.length, 12);
  });
});

// ---------------------------------------------------------------------------
// K-1 double-count prevention
// ---------------------------------------------------------------------------

describe("computeGlobalCashFlow — K-1 exclusion", () => {
  it("excludes K-1 income from entities in consolidation scope", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: 400_000,
      personalIncome: [
        { source: "W-2", annualAmount: 80_000, isRecurring: true, excludeIfInScope: false },
        {
          source: "K-1 from OpCo",
          annualAmount: 150_000,
          isRecurring: true,
          entityIdIfK1: "opco-1",
          excludeIfInScope: true,
        },
        {
          source: "K-1 from Outside LLC",
          annualAmount: 30_000,
          isRecurring: true,
          entityIdIfK1: "outside-llc",
          excludeIfInScope: true,
        },
      ],
      k1Exclusions: ["opco-1"], // only opco-1 is in consolidation scope
      businessDebtService: [],
      personalDebtService: [],
      proposedDebtService: 50_000,
    };

    const result = computeGlobalCashFlow(input);

    assert.equal(result.personalIncomeGross, 260_000); // 80K + 150K + 30K
    assert.equal(result.personalIncomeExcluded, 150_000); // only opco-1 K-1
    assert.equal(result.personalIncomeNet, 110_000); // 260K - 150K
    assert.equal(result.k1ExcludedItems.length, 1);
    assert.equal(result.k1ExcludedItems[0].source, "K-1 from OpCo");
    // Outside LLC K-1 is not excluded because entity not in scope
  });

  it("does not exclude K-1 when entity is not in scope", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: 200_000,
      personalIncome: [
        {
          source: "K-1 from LLC",
          annualAmount: 50_000,
          isRecurring: true,
          entityIdIfK1: "llc-1",
          excludeIfInScope: true,
        },
      ],
      k1Exclusions: [], // no entities in scope
      businessDebtService: [],
      personalDebtService: [],
      proposedDebtService: 0,
    };

    const result = computeGlobalCashFlow(input);
    assert.equal(result.personalIncomeExcluded, 0);
    assert.equal(result.personalIncomeNet, 50_000);
    assert.equal(result.k1ExcludedItems.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Null handling
// ---------------------------------------------------------------------------

describe("computeGlobalCashFlow — null NCADS", () => {
  it("returns null grossGlobalCashFlow when NCADS is null", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: null,
      personalIncome: [
        { source: "W-2", annualAmount: 100_000, isRecurring: true, excludeIfInScope: false },
      ],
      k1Exclusions: [],
      businessDebtService: [],
      personalDebtService: [],
      proposedDebtService: 50_000,
    };

    const result = computeGlobalCashFlow(input);
    assert.equal(result.grossGlobalCashFlow, null);
    assert.equal(result.netCashAfterAllObligations, null);
    assert.equal(result.globalDscr, null);
  });
});

// ---------------------------------------------------------------------------
// Personal living expense
// ---------------------------------------------------------------------------

describe("computeGlobalCashFlow — personal living expense", () => {
  it("uses default $36K when not provided", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: 100_000,
      personalIncome: [],
      k1Exclusions: [],
      businessDebtService: [],
      personalDebtService: [],
      proposedDebtService: 0,
    };
    const result = computeGlobalCashFlow(input);
    assert.equal(result.personalLivingExpense, 36_000);
  });

  it("uses custom living expense when provided", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: 100_000,
      personalIncome: [],
      k1Exclusions: [],
      businessDebtService: [],
      personalDebtService: [],
      proposedDebtService: 0,
      personalLivingExpense: 60_000,
    };
    const result = computeGlobalCashFlow(input);
    assert.equal(result.personalLivingExpense, 60_000);
  });
});

// ---------------------------------------------------------------------------
// Global DSCR edge cases
// ---------------------------------------------------------------------------

describe("computeGlobalCashFlow — DSCR edge cases", () => {
  it("returns null DSCR when total debt service is 0", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: 300_000,
      personalIncome: [],
      k1Exclusions: [],
      businessDebtService: [],
      personalDebtService: [],
      proposedDebtService: 0,
    };
    const result = computeGlobalCashFlow(input);
    assert.equal(result.globalDscr, null);
  });

  it("computes negative DSCR when cash flow is negative", () => {
    const input: GlobalCashFlowInput = {
      consolidatedBusinessNcads: -100_000,
      personalIncome: [],
      k1Exclusions: [],
      businessDebtService: [{ description: "Loan", annualAmount: 50_000 }],
      personalDebtService: [],
      proposedDebtService: 50_000,
      personalLivingExpense: 0,
    };
    const result = computeGlobalCashFlow(input);
    assert.ok(result.globalDscr !== null);
    assert.ok(result.globalDscr! < 0);
  });
});
