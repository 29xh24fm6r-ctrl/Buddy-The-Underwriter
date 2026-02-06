import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialStress } from "@/lib/deals/financialStressEngine";
import { buildEmptyMetric, type DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

function metric(value: number | null) {
  return { ...buildEmptyMetric(), value_num: value };
}

function makeSnapshot(overrides: Partial<DealFinancialSnapshotV1>): DealFinancialSnapshotV1 {
  const empty = buildEmptyMetric();
  return {
    version: 1,
    total_income_ttm: empty,
    noi_ttm: empty,
    opex_ttm: empty,
    cash_flow_available: empty,
    annual_debt_service: empty,
    excess_cash_flow: empty,
    dscr: empty,
    dscr_stressed_300bps: empty,
    collateral_gross_value: empty,
    collateral_net_value: empty,
    collateral_discounted_value: empty,
    collateral_coverage: empty,
    ltv_gross: empty,
    ltv_net: empty,
    in_place_rent_mo: empty,
    occupancy_pct: empty,
    vacancy_pct: empty,
    walt_years: empty,
    total_project_cost: empty,
    borrower_equity: empty,
    borrower_equity_pct: empty,
    bank_loan_total: empty,
    total_assets: empty,
    total_liabilities: empty,
    net_worth: empty,
    gross_receipts: empty,
    depreciation_addback: empty,
    global_cash_flow: empty,
    as_of_date: null,
    completeness_pct: 0,
    missing_required_keys: [],
    sources_summary: [],
    ...overrides,
  };
}

test("computeFinancialStress calculates base and stressed DSCR", () => {
  const snapshot = makeSnapshot({
    cash_flow_available: metric(120_000),
    annual_debt_service: metric(100_000),
  });

  const result = computeFinancialStress({
    snapshot,
    loanTerms: { principal: null, rate: null, amortMonths: null, interestOnly: null },
  });

  assert.equal(result.base.dscr?.toFixed(2), "1.20");
  assert.equal(result.stresses.vacancyUp.dscr?.toFixed(2), "1.08");
  assert.equal(result.stresses.rentDown.dscr?.toFixed(2), "1.08");
});

test("computeFinancialStress applies rate up scenario", () => {
  const snapshot = makeSnapshot({ cash_flow_available: metric(120_000) });

  const result = computeFinancialStress({
    snapshot,
    loanTerms: { principal: 1_000_000, rate: 0.08, amortMonths: null, interestOnly: true },
    stress: { rateUpBps: 200 },
  });

  assert.equal(result.base.dscr?.toFixed(2), "1.50");
  assert.equal(result.stresses.rateUp.dscr?.toFixed(2), "1.20");
});
