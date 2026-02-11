import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioSummary } from "@/lib/portfolio/portfolioAnalytics";
import { buildEmptyMetric, type DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

function snapshotWith(overrides: Partial<DealFinancialSnapshotV1>): DealFinancialSnapshotV1 {
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
    personal_total_income: empty,
    pfs_total_assets: empty,
    pfs_total_liabilities: empty,
    pfs_net_worth: empty,
    gcf_global_cash_flow: empty,
    gcf_dscr: empty,
    revenue: empty,
    cogs: empty,
    gross_profit: empty,
    ebitda: empty,
    net_income: empty,
    working_capital: empty,
    current_ratio: empty,
    debt_to_equity: empty,
    as_of_date: null,
    completeness_pct: 80,
    missing_required_keys: [],
    sources_summary: [],
    ...overrides,
  };
}

test("buildPortfolioSummary computes weighted DSCR", () => {
  const rows = [
    {
      deal_id: "a",
      snapshot: snapshotWith({
        dscr: { ...buildEmptyMetric(), value_num: 1.2 },
        bank_loan_total: { ...buildEmptyMetric(), value_num: 100 },
      }),
      decision: { stress: { stresses: { vacancyUp: { dscr: 1.0 } } }, sba: { status: "eligible" } },
      score: { score: 80, grade: "B" },
      deal: { deal_type: "CRE", geography: "CA" },
    },
    {
      deal_id: "b",
      snapshot: snapshotWith({
        dscr: { ...buildEmptyMetric(), value_num: 1.0 },
        bank_loan_total: { ...buildEmptyMetric(), value_num: 100 },
      }),
      decision: { stress: { stresses: { vacancyUp: { dscr: 0.9 } } }, sba: { status: "conditional" } },
      score: { score: 60, grade: "C" },
      deal: { deal_type: "CRE", geography: "CA" },
    },
  ];

  const summary = buildPortfolioSummary(rows as any);
  assert.equal(summary.weightedAvgDscr, 1.1);
  assert.equal(summary.totalDeals, 2);
});
