import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSbaForm1919 } from "@/lib/sba/forms/build1919";
import { buildSbaForm1920 } from "@/lib/sba/forms/build1920";
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

test("buildSbaForm1919 marks missing required fields", () => {
  const snap = snapshotWith({});
  const form = buildSbaForm1919({
    snapshot: snap,
    borrowerName: null,
    entityType: null,
    loanAmount: null,
    useOfProceeds: null,
    eligibility: { status: "conditional", reasons: [], missing: [] },
  });

  assert.ok(form.missing.includes("borrower_name"));
});

test("buildSbaForm1920 maps dscr and ltv", () => {
  const snap = snapshotWith({
    dscr: { ...buildEmptyMetric(), value_num: 1.25 },
    ltv_net: { ...buildEmptyMetric(), value_num: 68 },
  });
  const form = buildSbaForm1920({
    snapshot: snap,
    borrowerName: "Acme",
    loanAmount: 500000,
  });

  assert.equal(form.fields.dscr, 1.25);
  assert.equal(form.fields.ltv, 68);
});
