import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFinancialModel, type FactInput } from "../buildFinancialModel";

describe("buildFinancialModel", () => {
  it("groups facts by period and maps to correct slots", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1360479, fact_period_end: "2025-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "COST_OF_GOODS_SOLD", fact_value_num: 392171, fact_period_end: "2025-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "NET_INCOME", fact_value_num: 204096, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_ASSETS", fact_value_num: 2571777, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_LIABILITIES", fact_value_num: 20000, fact_period_end: "2025-12-31" },
    ];

    const model = buildFinancialModel("deal-1", facts);
    assert.equal(model.periods.length, 1);

    const period = model.periods[0];
    assert.equal(period.periodEnd, "2025-12-31");
    assert.equal(period.type, "FYE");
    assert.equal(period.income.revenue, 1360479);
    assert.equal(period.income.cogs, 392171);
    assert.equal(period.income.netIncome, 204096);
    assert.equal(period.balance.totalAssets, 2571777);
    assert.equal(period.balance.totalLiabilities, 20000);
  });

  it("promotes sentinel-date INCOME_STATEMENT facts to latest real period", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1000000, fact_period_end: "1900-01-01" },
      { fact_type: "INCOME_STATEMENT", fact_key: "NET_INCOME", fact_value_num: 100000, fact_period_end: "2025-06-30" },
    ];

    const model = buildFinancialModel("deal-2", facts);
    assert.equal(model.periods.length, 1);
    assert.equal(model.periods[0].periodEnd, "2025-06-30");
    // Sentinel-date INCOME_STATEMENT facts are promoted to latest real period
    // (T12 data from spreads uses 1900-01-01 as "current/undated")
    assert.equal(model.periods[0].income.revenue, 1000000);
    assert.equal(model.periods[0].income.netIncome, 100000);
  });

  it("skips sentinel-date facts when no real period exists", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1000000, fact_period_end: "1900-01-01" },
    ];

    const model = buildFinancialModel("deal-sentinel-only", facts);
    // No real period to promote to → sentinel facts are dropped
    assert.equal(model.periods.length, 0);
  });

  it("skips null period_end", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 500000, fact_period_end: null },
    ];

    const model = buildFinancialModel("deal-3", facts);
    assert.equal(model.periods.length, 0);
  });

  it("skips null fact_value_num", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: null, fact_period_end: "2025-12-31" },
    ];

    const model = buildFinancialModel("deal-4", facts);
    assert.equal(model.periods.length, 0);
  });

  it("derives EBITDA from revenue - cogs - opex + depreciation", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1000000, fact_period_end: "2025-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "COST_OF_GOODS_SOLD", fact_value_num: 400000, fact_period_end: "2025-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_OPERATING_EXPENSES", fact_value_num: 200000, fact_period_end: "2025-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "DEPRECIATION", fact_value_num: 50000, fact_period_end: "2025-12-31" },
    ];

    const model = buildFinancialModel("deal-5", facts);
    assert.equal(model.periods[0].cashflow.ebitda, 450000);
  });

  it("derives equity from totalAssets - totalLiabilities", () => {
    const facts: FactInput[] = [
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_ASSETS", fact_value_num: 3000000, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_LIABILITIES", fact_value_num: 1000000, fact_period_end: "2025-12-31" },
    ];

    const model = buildFinancialModel("deal-6", facts);
    assert.equal(model.periods[0].balance.equity, 2000000);
  });

  it("flags balance sheet imbalance", () => {
    const facts: FactInput[] = [
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_ASSETS", fact_value_num: 3000000, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_LIABILITIES", fact_value_num: 1000000, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_EQUITY", fact_value_num: 1500000, fact_period_end: "2025-12-31" },
    ];

    const model = buildFinancialModel("deal-7", facts);
    assert.ok(model.periods[0].qualityFlags.includes("BALANCE_SHEET_IMBALANCE"));
  });

  it("handles multiple periods sorted ascending", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 900000, fact_period_end: "2024-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1200000, fact_period_end: "2025-12-31" },
    ];

    const model = buildFinancialModel("deal-8", facts);
    assert.equal(model.periods.length, 2);
    assert.equal(model.periods[0].periodEnd, "2024-12-31");
    assert.equal(model.periods[1].periodEnd, "2025-12-31");
    assert.equal(model.periods[0].income.revenue, 900000);
    assert.equal(model.periods[1].income.revenue, 1200000);
  });

  it("returns empty model for irrelevant fact types", () => {
    const facts: FactInput[] = [
      { fact_type: "EXTRACTION_HEARTBEAT", fact_key: "document:abc", fact_value_num: 1548, fact_period_end: "2025-12-31" },
    ];

    const model = buildFinancialModel("deal-9", facts);
    assert.equal(model.periods.length, 0);
  });

  it("returns empty model for empty facts", () => {
    const model = buildFinancialModel("deal-10", []);
    assert.equal(model.periods.length, 0);
    assert.equal(model.dealId, "deal-10");
  });

  // SPEC-FINENGINE-CANONICAL-FACT-BRIDGE-1 — source-line keys normalize into slots
  it("normalizes a source-line balance key (SL_CASH) into balance.cash", () => {
    const facts: FactInput[] = [
      { fact_type: "BALANCE_SHEET", fact_key: "SL_CASH", fact_value_num: 198692.59, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "SL_TOTAL_ASSETS", fact_value_num: 3342586, fact_period_end: "2025-12-31" },
    ];
    const period = buildFinancialModel("deal-bridge-1", facts).periods[0];
    assert.equal(period.balance.cash, 198692.59);
    assert.equal(period.balance.totalAssets, 3342586);
  });

  it("normalizes a source-line income key (SALARIES_WAGES_IS) into income.payroll", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "SALARIES_WAGES_IS", fact_value_num: 150000, fact_period_end: "2025-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "RENT_EXPENSE_IS", fact_value_num: 42000, fact_period_end: "2025-12-31" },
    ];
    const period = buildFinancialModel("deal-bridge-2", facts).periods[0];
    assert.equal(period.income.payroll, 150000);
    assert.equal(period.income.rent, 42000);
  });

  // SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1 — QuickBooks AR/OCA double-count
  it("suppresses Other Current Assets when it equals Accounts Receivable (QB nesting)", () => {
    const facts: FactInput[] = [
      { fact_type: "BALANCE_SHEET", fact_key: "SL_AR_GROSS", fact_value_num: 2393922, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "SL_OTHER_CURRENT_ASSETS", fact_value_num: 2393922, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "SL_CASH", fact_value_num: 739144, fact_period_end: "2025-12-31" },
    ];
    const period = buildFinancialModel("deal-qb", facts).periods[0];
    assert.equal(period.balance.accountsReceivable, 2393922);
    assert.equal(period.balance.otherCurrentAssets, undefined, "OCA suppressed as duplicate of AR");
    assert.equal(period.balance.cash, 739144);
    // Derived TCA = cash + AR (+ 0 inventory + 0 suppressed OCA) — no double-count.
    assert.equal(period.balance.totalCurrentAssets, 3133066);
  });

  it("keeps Other Current Assets when it genuinely differs from AR", () => {
    const facts: FactInput[] = [
      { fact_type: "BALANCE_SHEET", fact_key: "SL_AR_GROSS", fact_value_num: 2000000, fact_period_end: "2025-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "SL_OTHER_CURRENT_ASSETS", fact_value_num: 500000, fact_period_end: "2025-12-31" },
    ];
    const period = buildFinancialModel("deal-qb2", facts).periods[0];
    assert.equal(period.balance.accountsReceivable, 2000000);
    assert.equal(period.balance.otherCurrentAssets, 500000);
  });

  // SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1 — long-term debt accumulation
  it("maps a single shareholder-loan fact to longTermDebt", () => {
    const facts: FactInput[] = [
      { fact_type: "TAX_RETURN", fact_key: "SL_LOANS_FROM_SHAREHOLDERS", fact_value_num: 1503500, fact_period_end: "2022-12-31" },
    ];
    const period = buildFinancialModel("deal-ltd1", facts).periods[0];
    assert.equal(period.balance.longTermDebt, 1503500);
  });

  it("de-dupes identical long-term-debt values reported on two Schedule L lines", () => {
    const facts: FactInput[] = [
      { fact_type: "TAX_RETURN", fact_key: "SL_LOANS_FROM_SHAREHOLDERS", fact_value_num: 1730705, fact_period_end: "2023-12-31" },
      { fact_type: "TAX_RETURN", fact_key: "SL_MORTGAGES_NOTES_BONDS", fact_value_num: 1730705, fact_period_end: "2023-12-31" },
    ];
    const period = buildFinancialModel("deal-ltd2", facts).periods[0];
    assert.equal(period.balance.longTermDebt, 1730705, "same loan on two lines is not doubled");
  });

  it("sums genuinely distinct long-term-debt sources", () => {
    const facts: FactInput[] = [
      { fact_type: "TAX_RETURN", fact_key: "SL_LOANS_FROM_SHAREHOLDERS", fact_value_num: 200000, fact_period_end: "2024-12-31" },
      { fact_type: "TAX_RETURN", fact_key: "SL_MORTGAGES_NOTES_BONDS", fact_value_num: 1730705, fact_period_end: "2024-12-31" },
    ];
    const period = buildFinancialModel("deal-ltd3", facts).periods[0];
    assert.equal(period.balance.longTermDebt, 1930705, "distinct debts sum");
  });
});
