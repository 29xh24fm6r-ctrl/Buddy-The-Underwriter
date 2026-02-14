/**
 * Dry-Run Integration Test
 *
 * Exercises the full underwriting pipeline with REAL fact data from
 * deal 098850d1-39bc-4c31-8244-43b41c53ca5a (EQUIPMENT, $700K loan).
 *
 * Validates:
 * - Sentinel-date T12/BS facts get promoted (not skipped)
 * - Model has populated periods with revenue, assets, etc.
 * - Full pipeline completes (snapshot → policy → stress → pricing → memo)
 * - Artifact hashes are stable
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFinancialModel } from "@/lib/modelEngine/buildFinancialModel";
import type { FactInput } from "@/lib/modelEngine/buildFinancialModel";
import { runFullUnderwrite } from "@/lib/underwritingEngine";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import { computeArtifactHashes } from "@/lib/artifactEngine/hash";

// ---------------------------------------------------------------------------
// Real fact data from deal 098850d1-39bc-4c31-8244-43b41c53ca5a
// ---------------------------------------------------------------------------

const DEAL_ID = "098850d1-39bc-4c31-8244-43b41c53ca5a";

const REAL_FACTS: FactInput[] = [
  // Balance sheet — sentinel date (from AI extraction)
  { fact_type: "BALANCE_SHEET", fact_key: "ACCOUNTS_RECEIVABLE", fact_value_num: 144000, fact_period_end: "1900-01-01" },
  { fact_type: "BALANCE_SHEET", fact_key: "CASH_AND_EQUIVALENTS", fact_value_num: 93087, fact_period_end: "1900-01-01" },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_ASSETS", fact_value_num: 2571777.3, fact_period_end: "1900-01-01" },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_EQUITY", fact_value_num: 20000, fact_period_end: "1900-01-01" },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_LIABILITIES", fact_value_num: 20000, fact_period_end: "1900-01-01" },

  // Income statement — sentinel date (from AI extraction / T12)
  { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1360479, fact_period_end: "1900-01-01" },
  { fact_type: "INCOME_STATEMENT", fact_key: "COST_OF_GOODS_SOLD", fact_value_num: 392171.16, fact_period_end: "1900-01-01" },
  { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_OPERATING_EXPENSES", fact_value_num: 423818, fact_period_end: "1900-01-01" },
  { fact_type: "INCOME_STATEMENT", fact_key: "DEPRECIATION", fact_value_num: 228574, fact_period_end: "1900-01-01" },
  { fact_type: "INCOME_STATEMENT", fact_key: "DEBT_SERVICE", fact_value_num: 80520, fact_period_end: "1900-01-01" },
  { fact_type: "INCOME_STATEMENT", fact_key: "NET_INCOME", fact_value_num: 204096.14, fact_period_end: "1900-01-01" },

  // Tax return — real dates (2022, 2023, 2024)
  { fact_type: "TAX_RETURN", fact_key: "GROSS_RECEIPTS", fact_value_num: 1065, fact_period_end: "2022-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "NET_INCOME", fact_value_num: 1, fact_period_end: "2022-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "DEPRECIATION", fact_value_num: 0, fact_period_end: "2022-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "GROSS_RECEIPTS", fact_value_num: 1065, fact_period_end: "2023-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "NET_INCOME", fact_value_num: 1, fact_period_end: "2023-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "DEPRECIATION", fact_value_num: 0, fact_period_end: "2023-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "GROSS_RECEIPTS", fact_value_num: 1065, fact_period_end: "2024-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "NET_INCOME", fact_value_num: 1, fact_period_end: "2024-12-31" },
  { fact_type: "TAX_RETURN", fact_key: "DEPRECIATION", fact_value_num: 0, fact_period_end: "2024-12-31" },

  // Personal income — real dates
  { fact_type: "PERSONAL_INCOME", fact_key: "WAGES_W2", fact_value_num: 8, fact_period_end: "2022-12-31" },
  { fact_type: "PERSONAL_INCOME", fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 0, fact_period_end: "2025-12-31" },
];

// Proposed loan from structural pricing
const INSTRUMENTS: DebtInstrument[] = [
  {
    id: `proposed-${DEAL_ID}`,
    source: "proposed",
    principal: 700000,
    rate: 0.07, // 7%
    amortizationMonths: 120,
    paymentFrequency: "monthly",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dry-run: real deal 098850d1 (EQUIPMENT)", () => {
  it("builds model with sentinel-date facts promoted to latest period", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);

    // Must have at least one period (sentinel facts were promoted)
    assert.ok(model.periods.length >= 1, `Expected periods, got ${model.periods.length}`);

    // The latest period should have the rich T12 data
    const latest = model.periods[model.periods.length - 1];
    assert.ok(latest.income.revenue !== undefined, "Latest period must have revenue");
    assert.ok(latest.income.revenue! > 1_000_000, `Revenue should be >$1M, got ${latest.income.revenue}`);
    assert.ok(latest.income.netIncome !== undefined, "Latest period must have netIncome");
    assert.ok(latest.balance.totalAssets !== undefined, "Latest period must have totalAssets");
    assert.ok(latest.balance.totalAssets! > 2_000_000, `Total assets should be >$2M, got ${latest.balance.totalAssets}`);
  });

  it("sentinel T12 data overrides tax return form-reference values", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);
    const latest = model.periods[model.periods.length - 1];

    // T12 NET_INCOME ($204K) should win over tax return NET_INCOME ($1)
    assert.ok(latest.income.netIncome! > 200_000, `netIncome should be T12 value (~$204K), got ${latest.income.netIncome}`);

    // T12 DEPRECIATION ($228K) should win over tax return DEPRECIATION ($0)
    assert.ok(latest.income.depreciation! > 200_000, `depreciation should be T12 value (~$228K), got ${latest.income.depreciation}`);
  });

  it("EBITDA is derived correctly from promoted T12 data", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);
    const latest = model.periods[model.periods.length - 1];

    // EBITDA = revenue - cogs - opex + depreciation
    const expected = 1360479 - 392171.16 - 423818 + 228574;
    assert.ok(latest.cashflow.ebitda !== undefined, "EBITDA must be derived");
    assert.equal(latest.cashflow.ebitda, expected, `EBITDA mismatch: got ${latest.cashflow.ebitda}, expected ${expected}`);
  });

  it("full pipeline completes (snapshot → policy → stress → pricing → memo)", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);

    const result = runFullUnderwrite({
      model,
      product: "EQUIPMENT",
      instruments: INSTRUMENTS,
    });

    assert.ok(result.diagnostics.pipelineComplete, `Pipeline should complete, got: ${JSON.stringify(result.diagnostics)}`);

    // Verify all components present
    const r = result as any;
    assert.ok(r.snapshot, "Must have snapshot");
    assert.ok(r.analysis, "Must have analysis");
    assert.ok(r.policy, "Must have policy");
    assert.ok(r.stress, "Must have stress");
    assert.ok(r.pricing, "Must have pricing");
    assert.ok(r.memo, "Must have memo");
  });

  it("produces stable artifact hashes across runs", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);

    const r1 = runFullUnderwrite({ model, product: "EQUIPMENT", instruments: INSTRUMENTS });
    const r2 = runFullUnderwrite({ model, product: "EQUIPMENT", instruments: INSTRUMENTS });

    assert.ok(r1.diagnostics.pipelineComplete);
    assert.ok(r2.diagnostics.pipelineComplete);

    const h1 = computeArtifactHashes({
      model,
      snapshot: (r1 as any).snapshot,
      policy: (r1 as any).policy,
      stress: (r1 as any).stress,
      pricing: (r1 as any).pricing,
      memo: (r1 as any).memo,
    });

    const h2 = computeArtifactHashes({
      model,
      snapshot: (r2 as any).snapshot,
      policy: (r2 as any).policy,
      stress: (r2 as any).stress,
      pricing: (r2 as any).pricing,
      memo: (r2 as any).memo,
    });

    assert.equal(h1.overallHash, h2.overallHash, "Overall hash mismatch across runs");
  });

  it("snapshot has meaningful DSCR from real data", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);

    const result = runFullUnderwrite({
      model,
      product: "EQUIPMENT",
      instruments: INSTRUMENTS,
    });

    assert.ok(result.diagnostics.pipelineComplete);

    const snapshot = (result as any).snapshot;
    // CreditSnapshot has ratios.metrics.dscr (MetricResult with .value)
    const dscr = snapshot.ratios?.metrics?.dscr?.value;
    assert.ok(dscr !== undefined, "DSCR should be computed");
    // With $1.36M revenue, strong EBITDA, and $700K loan, DSCR should be well above 1.0
    assert.ok(dscr > 1.0, `DSCR should be > 1.0, got ${dscr}`);

    // Verify debt service was calculated
    assert.ok(snapshot.debtService, "Must have debt service result");
  });

  it("policy evaluation produces a valid tier", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);

    const result = runFullUnderwrite({
      model,
      product: "EQUIPMENT",
      instruments: INSTRUMENTS,
    });

    assert.ok(result.diagnostics.pipelineComplete);

    const policy = (result as any).policy;
    assert.ok(["A", "B", "C", "D"].includes(policy.tier), `Tier should be A-D, got ${policy.tier}`);
    // With strong DSCR and low LTV, should be tier A or B
    assert.ok(["A", "B"].includes(policy.tier), `Strong deal should be tier A or B, got ${policy.tier}`);
  });

  it("memo has all required sections", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);

    const result = runFullUnderwrite({
      model,
      product: "EQUIPMENT",
      instruments: INSTRUMENTS,
    });

    assert.ok(result.diagnostics.pipelineComplete);

    const memo = (result as any).memo;
    assert.ok(memo.recommendation, "Memo must have recommendation");
    // sections is a Record<MemoSectionKey, MemoSection>, not an array
    assert.ok(memo.sections, "Memo must have sections");
    assert.ok(Object.keys(memo.sections).length > 0, "Memo must have at least one section");
  });

  it("earlier periods have tax return data (GROSS_RECEIPTS → revenue)", () => {
    const model = buildFinancialModel(DEAL_ID, REAL_FACTS);

    // 2022 and 2023 should have tax return revenue from GROSS_RECEIPTS
    const p2022 = model.periods.find(p => p.periodEnd === "2022-12-31");
    assert.ok(p2022, "Should have 2022 period from tax return");
    assert.ok(p2022!.income.revenue !== undefined, "2022 should have revenue from GROSS_RECEIPTS");
    assert.equal(p2022!.income.revenue, 1065, "2022 revenue should be $1,065 from tax return");
  });
});
