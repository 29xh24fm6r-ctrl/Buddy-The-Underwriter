import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runConsolidation,
  type ConsolidationInput,
  type EntityFinancials,
} from "../consolidationEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntityFinancials(overrides: Partial<EntityFinancials> & { entityId: string }): EntityFinancials {
  return {
    entityName: overrides.entityId,
    taxYear: 2024,
    fiscalYearEnd: "12-31",
    accountingBasis: "accrual",
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    operatingExpenses: 0,
    interestExpense: 0,
    depreciation: 0,
    amortization: 0,
    netIncome: 0,
    ebitda: 0,
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalFundedDebt: 0,
    annualDebtService: 0,
    ncads: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic consolidation
// ---------------------------------------------------------------------------

describe("runConsolidation — basic aggregation", () => {
  it("aggregates two entities with no IC transactions", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "opco",
          revenue: 1_000_000,
          cogs: 400_000,
          grossProfit: 600_000,
          operatingExpenses: 200_000,
          interestExpense: 50_000,
          depreciation: 30_000,
          amortization: 10_000,
          netIncome: 350_000,
          ebitda: 440_000,
          totalAssets: 2_000_000,
          totalLiabilities: 1_200_000,
          totalEquity: 800_000,
          totalFundedDebt: 900_000,
          annualDebtService: 100_000,
          ncads: 340_000,
        }),
        makeEntityFinancials({
          entityId: "propco",
          revenue: 500_000,
          cogs: 0,
          grossProfit: 500_000,
          operatingExpenses: 100_000,
          interestExpense: 25_000,
          depreciation: 50_000,
          amortization: 0,
          netIncome: 375_000,
          ebitda: 450_000,
          totalAssets: 3_000_000,
          totalLiabilities: 2_000_000,
          totalEquity: 1_000_000,
          totalFundedDebt: 1_500_000,
          annualDebtService: 150_000,
          ncads: 300_000,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.ok(result.consolidatedFinancials);

    const cf = result.consolidatedFinancials;
    assert.equal(cf.consRevenue, 1_500_000);
    assert.equal(cf.consCogs, 400_000);
    assert.equal(cf.consTotalAssets, 5_000_000);
    assert.equal(cf.consTotalLiabilities, 3_200_000);
    assert.equal(cf.consTotalEquity, 1_800_000);
    assert.equal(result.balanceSheetBalanced, true);
    assert.equal(result.entityCount, 2);
  });

  it("returns error for empty entities", () => {
    const input: ConsolidationInput = {
      entities: [],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };
    const result = runConsolidation(input);
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("No entities"));
  });
});

// ---------------------------------------------------------------------------
// IC eliminations
// ---------------------------------------------------------------------------

describe("runConsolidation — IC eliminations", () => {
  it("eliminates intercompany rent (revenue & expense)", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "opco",
          revenue: 1_000_000,
          cogs: 300_000,
          grossProfit: 700_000,
          operatingExpenses: 200_000,
          interestExpense: 0,
          depreciation: 50_000,
          amortization: 0,
          netIncome: 500_000,
          ebitda: 550_000,
          totalAssets: 2_000_000,
          totalLiabilities: 1_000_000,
          totalEquity: 1_000_000,
          totalFundedDebt: 500_000,
          annualDebtService: 60_000,
          ncads: 490_000,
        }),
        makeEntityFinancials({
          entityId: "propco",
          revenue: 120_000, // intercompany rent
          cogs: 0,
          grossProfit: 120_000,
          operatingExpenses: 20_000,
          interestExpense: 30_000,
          depreciation: 40_000,
          amortization: 0,
          netIncome: 70_000,
          ebitda: 140_000,
          totalAssets: 1_500_000,
          totalLiabilities: 900_000,
          totalEquity: 600_000,
          totalFundedDebt: 800_000,
          annualDebtService: 50_000,
          ncads: 90_000,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [{
        transactionId: "ic-1",
        transactionType: "rent",
        payingEntityId: "opco",
        receivingEntityId: "propco",
        annualAmount: 120_000,
        detectionMethod: "amount_match",
        confidence: "high",
        payingLineItem: "RENT_EXPENSE",
        receivingLineItem: "TOTAL_REVENUE",
        eliminationRequired: true,
        documentation: "IC rent",
        bankerConfirmed: true,
      }],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.ok(result.consolidatedFinancials);

    const cf = result.consolidatedFinancials;
    // Revenue: 1_000_000 + 120_000 - 120_000 = 1_000_000
    assert.equal(cf.consRevenue, 1_000_000);
    // OpEx: 200_000 + 20_000 - 120_000 = 100_000
    assert.equal(cf.consOperatingExpenses, 100_000);
    assert.equal(result.totalRevenueEliminated, 120_000);
    assert.equal(result.totalExpenseEliminated, 120_000);
    assert.equal(result.eliminations.length, 1);
  });

  it("eliminates intercompany loans (assets & liabilities)", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "lender",
          revenue: 500_000,
          cogs: 200_000,
          grossProfit: 300_000,
          operatingExpenses: 100_000,
          depreciation: 20_000,
          netIncome: 200_000,
          ebitda: 220_000,
          totalAssets: 2_500_000, // includes 200K IC loan receivable
          totalLiabilities: 1_500_000,
          totalEquity: 1_000_000,
          totalFundedDebt: 1_000_000,
          annualDebtService: 80_000,
          ncads: 140_000,
        }),
        makeEntityFinancials({
          entityId: "borrower",
          revenue: 300_000,
          cogs: 100_000,
          grossProfit: 200_000,
          operatingExpenses: 50_000,
          depreciation: 10_000,
          netIncome: 150_000,
          ebitda: 160_000,
          totalAssets: 1_000_000,
          totalLiabilities: 700_000, // includes 200K IC loan payable
          totalEquity: 300_000,
          totalFundedDebt: 600_000,
          annualDebtService: 40_000,
          ncads: 120_000,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [{
        transactionId: "ic-loan-1",
        transactionType: "loan",
        payingEntityId: "borrower",
        receivingEntityId: "lender",
        annualAmount: 200_000,
        detectionMethod: "tax_return_disclosure",
        confidence: "high",
        payingLineItem: "SL_MORTGAGES_NOTES_BONDS",
        receivingLineItem: "SL_SHAREHOLDER_LOANS_RECEIVABLE",
        eliminationRequired: true,
        documentation: "IC loan",
        bankerConfirmed: true,
      }],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.ok(result.consolidatedFinancials);

    const cf = result.consolidatedFinancials;
    // Assets: 2_500_000 + 1_000_000 - 200_000 = 3_300_000
    assert.equal(cf.consTotalAssets, 3_300_000);
    // Liabilities: 1_500_000 + 700_000 - 200_000 = 2_000_000
    assert.equal(cf.consTotalLiabilities, 2_000_000);
    assert.equal(result.totalLoansEliminated, 200_000);
    assert.equal(result.balanceSheetBalanced, true);
  });
});

// ---------------------------------------------------------------------------
// Balance sheet invariant
// ---------------------------------------------------------------------------

describe("runConsolidation — balance sheet invariant", () => {
  it("HARD ERROR when BS does not balance", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "broken",
          revenue: 100_000,
          cogs: 0,
          grossProfit: 100_000,
          operatingExpenses: 0,
          netIncome: 100_000,
          ebitda: 100_000,
          totalAssets: 500_000,
          totalLiabilities: 200_000,
          totalEquity: 100_000, // broken: 500K ≠ 200K + 100K
          totalFundedDebt: 0,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("BALANCE SHEET INVARIANT FAILED"));
    assert.equal(result.balanceSheetBalanced, false);
    assert.equal(result.confidence, "low");
    assert.ok(result.flags.some((f) => f.code === "BS_INVARIANT_FAIL"));
  });

  it("passes with $1 rounding tolerance", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "close",
          revenue: 100_000,
          grossProfit: 100_000,
          netIncome: 100_000,
          ebitda: 100_000,
          totalAssets: 1_000_001, // off by $1
          totalLiabilities: 600_000,
          totalEquity: 400_000,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.equal(result.balanceSheetBalanced, true);
  });
});

// ---------------------------------------------------------------------------
// Minority interest
// ---------------------------------------------------------------------------

describe("runConsolidation — minority interest", () => {
  it("adjusts for minority interest on <100% owned subsidiary", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "parent",
          revenue: 500_000,
          grossProfit: 500_000,
          netIncome: 200_000,
          ebitda: 200_000,
          totalAssets: 1_000_000,
          totalLiabilities: 400_000,
          totalEquity: 600_000,
        }),
        makeEntityFinancials({
          entityId: "child",
          revenue: 300_000,
          grossProfit: 300_000,
          netIncome: 100_000,
          ebitda: 100_000,
          totalAssets: 500_000,
          totalLiabilities: 200_000,
          totalEquity: 300_000,
        }),
      ],
      relationships: [{
        relationshipId: "rel-1",
        parentEntityId: "parent",
        childEntityId: "child",
        relationshipType: "parent_subsidiary",
        ownershipPct: 80,
        controlType: "majority",
        consolidationRequired: true,
      }],
      intercompanyTransactions: [],
      consolidationMethod: "full_consolidation",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.ok(result.consolidatedFinancials);
    assert.equal(result.minorityInterests.length, 1);

    const mi = result.minorityInterests[0];
    assert.equal(mi.entityId, "child");
    assert.equal(mi.minorityPct, 20);
    // 20% of child equity 300K = 60K
    assert.equal(mi.minorityInterestEquity, 60_000);
    // 20% of child net income 100K = 20K
    assert.equal(mi.minorityInterestIncome, 20_000);

    const cf = result.consolidatedFinancials;
    // MI tracked as memo — aggregated totals are NOT reduced
    // Equity: 600K + 300K = 900K (controlling interest = 900K - 60K MI = 840K, computed externally)
    assert.equal(cf.consTotalEquity, 900_000);
    // BS must balance: 1.5M = 600K + 900K
    assert.equal(result.balanceSheetBalanced, true);
  });
});

// ---------------------------------------------------------------------------
// Fiscal year alignment flags
// ---------------------------------------------------------------------------

describe("runConsolidation — fiscal year alignment", () => {
  it("flags entities with >6 month offset", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "dec",
          fiscalYearEnd: "12-31",
          totalAssets: 100,
          totalLiabilities: 50,
          totalEquity: 50,
        }),
        makeEntityFinancials({
          entityId: "mar",
          fiscalYearEnd: "03-31",
          totalAssets: 100,
          totalLiabilities: 50,
          totalEquity: 50,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.ok(result.fiscalYearAlignments.length === 2);
    // March FY end = 9 month offset
    const marAlign = result.fiscalYearAlignments.find((a) => a.entityId === "mar");
    assert.ok(marAlign);
    assert.ok(marAlign.offsetMonths > 6);
    assert.equal(marAlign.flag, true);
    assert.ok(result.flags.some((f) => f.code === "FISCAL_YEAR_MISMATCH"));
  });
});

// ---------------------------------------------------------------------------
// DSCR
// ---------------------------------------------------------------------------

describe("runConsolidation — DSCR", () => {
  it("computes DSCR when debt service > 0", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "biz",
          revenue: 1_000_000,
          cogs: 400_000,
          grossProfit: 600_000,
          operatingExpenses: 200_000,
          interestExpense: 50_000,
          depreciation: 30_000,
          amortization: 10_000,
          netIncome: 350_000,
          ebitda: 440_000,
          totalAssets: 2_000_000,
          totalLiabilities: 1_000_000,
          totalEquity: 1_000_000,
          totalFundedDebt: 800_000,
          annualDebtService: 200_000,
          ncads: 240_000,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.ok(result.consolidatedFinancials);
    // NCADS recomputed = EBITDA - ADS = derived from: netIncome + interest + dep + amort - ADS
    // After recomputation in the engine, NCADS = consEbitda - consADS
    assert.ok(result.consolidatedFinancials.consDscr !== null);
    assert.ok(result.consolidatedFinancials.consDscr! > 0);
  });

  it("returns null DSCR when no debt service", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "biz",
          revenue: 100_000,
          grossProfit: 100_000,
          netIncome: 100_000,
          ebitda: 100_000,
          totalAssets: 500_000,
          totalLiabilities: 200_000,
          totalEquity: 300_000,
          annualDebtService: 0,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };

    const result = runConsolidation(input);
    assert.equal(result.ok, true);
    assert.equal(result.consolidatedFinancials?.consDscr, null);
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe("runConsolidation — confidence", () => {
  it("returns high confidence with no flags and confirmed transactions", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "a",
          totalAssets: 100,
          totalLiabilities: 50,
          totalEquity: 50,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };
    const result = runConsolidation(input);
    assert.equal(result.confidence, "high");
  });

  it("returns medium confidence with unconfirmed IC transactions", () => {
    const input: ConsolidationInput = {
      entities: [
        makeEntityFinancials({
          entityId: "a",
          revenue: 100_000,
          cogs: 0,
          grossProfit: 100_000,
          operatingExpenses: 10_000,
          netIncome: 90_000,
          ebitda: 90_000,
          totalAssets: 500_000,
          totalLiabilities: 200_000,
          totalEquity: 300_000,
        }),
        makeEntityFinancials({
          entityId: "b",
          revenue: 10_000,
          cogs: 0,
          grossProfit: 10_000,
          operatingExpenses: 10_000,
          netIncome: 0,
          ebitda: 0,
          totalAssets: 100_000,
          totalLiabilities: 50_000,
          totalEquity: 50_000,
        }),
      ],
      relationships: [],
      intercompanyTransactions: [{
        transactionId: "ic-1",
        transactionType: "rent",
        payingEntityId: "a",
        receivingEntityId: "b",
        annualAmount: 10_000,
        detectionMethod: "amount_match",
        confidence: "medium",
        payingLineItem: "RENT_EXPENSE",
        receivingLineItem: "TOTAL_REVENUE",
        eliminationRequired: true,
        documentation: "test",
        bankerConfirmed: false, // unconfirmed
      }],
      consolidationMethod: "combined",
      consolidationYear: 2024,
    };
    const result = runConsolidation(input);
    assert.equal(result.confidence, "medium");
  });
});
