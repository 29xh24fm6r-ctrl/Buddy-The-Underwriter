import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildConsolidationBridge,
  formatBridgeAsMarkdown,
} from "../consolidationBridge";
import type { EntityFinancials, ConsolidatedFinancials, EliminationEntry } from "../consolidationEngine";

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

function makeConsolidatedFinancials(overrides: Partial<ConsolidatedFinancials> = {}): ConsolidatedFinancials {
  return {
    consRevenue: 0,
    consCogs: 0,
    consGrossProfit: 0,
    consOperatingExpenses: 0,
    consInterestExpense: 0,
    consDepreciation: 0,
    consAmortization: 0,
    consNetIncome: 0,
    consEbitda: 0,
    consTotalAssets: 0,
    consTotalLiabilities: 0,
    consTotalEquity: 0,
    consTotalFundedDebt: 0,
    consAnnualDebtService: 0,
    consNcads: 0,
    consDscr: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildConsolidationBridge
// ---------------------------------------------------------------------------

describe("buildConsolidationBridge", () => {
  it("produces correct line items for 2 entities", () => {
    const entities: EntityFinancials[] = [
      makeEntityFinancials({
        entityId: "opco",
        entityName: "OpCo LLC",
        revenue: 1_000_000,
        cogs: 400_000,
        grossProfit: 600_000,
        totalAssets: 2_000_000,
        totalLiabilities: 1_200_000,
        totalEquity: 800_000,
      }),
      makeEntityFinancials({
        entityId: "propco",
        entityName: "PropCo LLC",
        revenue: 120_000,
        grossProfit: 120_000,
        totalAssets: 1_500_000,
        totalLiabilities: 900_000,
        totalEquity: 600_000,
      }),
    ];

    const consolidated = makeConsolidatedFinancials({
      consRevenue: 1_000_000,
      consCogs: 400_000,
      consGrossProfit: 600_000,
      consTotalAssets: 3_500_000,
      consTotalLiabilities: 2_100_000,
      consTotalEquity: 1_400_000,
    });

    const bridge = buildConsolidationBridge(
      entities, consolidated, 120_000, 120_000, 0, [],
    );

    assert.equal(bridge.entityCount, 2);
    assert.deepEqual(bridge.entityNames, ["OpCo LLC", "PropCo LLC"]);
    assert.equal(bridge.lineItems.length, 14); // 14 LINE_SPECS

    // Check revenue line
    const revLine = bridge.lineItems.find((l) => l.canonicalKey === "CONS_REVENUE");
    assert.ok(revLine);
    assert.equal(revLine.entities["OpCo LLC"], 1_000_000);
    assert.equal(revLine.entities["PropCo LLC"], 120_000);
    assert.equal(revLine.eliminations, -120_000);
    assert.equal(revLine.consolidatedTotal, 1_000_000);
    assert.equal(revLine.isSubtotal, false);
  });

  it("marks subtotal and ratio lines correctly", () => {
    const entities: EntityFinancials[] = [
      makeEntityFinancials({ entityId: "a", entityName: "A" }),
    ];
    const consolidated = makeConsolidatedFinancials({ consDscr: 1.25 });

    const bridge = buildConsolidationBridge(entities, consolidated, 0, 0, 0, []);

    const grossProfit = bridge.lineItems.find((l) => l.canonicalKey === "CONS_GROSS_PROFIT");
    assert.ok(grossProfit);
    assert.equal(grossProfit.isSubtotal, true);

    const dscr = bridge.lineItems.find((l) => l.canonicalKey === "CONS_DSCR");
    assert.ok(dscr);
    assert.equal(dscr.isRatio, true);
  });

  it("computes interest eliminated from elimination entries", () => {
    const entities: EntityFinancials[] = [
      makeEntityFinancials({
        entityId: "a",
        entityName: "A",
        interestExpense: 50_000,
      }),
      makeEntityFinancials({
        entityId: "b",
        entityName: "B",
        revenue: 50_000,
      }),
    ];
    const consolidated = makeConsolidatedFinancials({
      consInterestExpense: 25_000,
    });
    const eliminations: EliminationEntry[] = [{
      transactionId: "ic-1",
      transactionType: "interest",
      debitEntityId: "b",
      debitLine: "TOTAL_REVENUE",
      debitAmount: 25_000,
      creditEntityId: "a",
      creditLine: "INTEREST_EXPENSE",
      creditAmount: 25_000,
    }];

    const bridge = buildConsolidationBridge(
      entities, consolidated, 25_000, 25_000, 0, eliminations,
    );

    const interestLine = bridge.lineItems.find((l) => l.canonicalKey === "CONS_INTEREST");
    assert.ok(interestLine);
    assert.equal(interestLine.eliminations, -25_000);
  });
});

// ---------------------------------------------------------------------------
// formatBridgeAsMarkdown
// ---------------------------------------------------------------------------

describe("formatBridgeAsMarkdown", () => {
  it("produces valid markdown table", () => {
    const entities: EntityFinancials[] = [
      makeEntityFinancials({
        entityId: "a",
        entityName: "OpCo",
        revenue: 500_000,
      }),
    ];
    const consolidated = makeConsolidatedFinancials({
      consRevenue: 500_000,
      consDscr: 1.50,
    });

    const bridge = buildConsolidationBridge(entities, consolidated, 0, 0, 0, []);
    const md = formatBridgeAsMarkdown(bridge);

    assert.ok(md.includes("| Line Item |"));
    assert.ok(md.includes("OpCo"));
    assert.ok(md.includes("Eliminations"));
    assert.ok(md.includes("Consolidated"));
    // DSCR should have "x" format
    assert.ok(md.includes("1.50x"));
    // Revenue should have $ format
    assert.ok(md.includes("$500,000"));
  });

  it("renders subtotal labels in bold", () => {
    const entities: EntityFinancials[] = [
      makeEntityFinancials({ entityId: "a", entityName: "A" }),
    ];
    const consolidated = makeConsolidatedFinancials();
    const bridge = buildConsolidationBridge(entities, consolidated, 0, 0, 0, []);
    const md = formatBridgeAsMarkdown(bridge);

    // Gross Profit is a subtotal → should be bold
    assert.ok(md.includes("**Gross Profit**"));
  });
});
