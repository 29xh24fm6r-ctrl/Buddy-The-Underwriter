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

  it("skips sentinel date 1900-01-01", () => {
    const facts: FactInput[] = [
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1000000, fact_period_end: "1900-01-01" },
      { fact_type: "INCOME_STATEMENT", fact_key: "NET_INCOME", fact_value_num: 100000, fact_period_end: "2025-06-30" },
    ];

    const model = buildFinancialModel("deal-2", facts);
    assert.equal(model.periods.length, 1);
    assert.equal(model.periods[0].periodEnd, "2025-06-30");
    assert.equal(model.periods[0].income.revenue, undefined);
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
});
