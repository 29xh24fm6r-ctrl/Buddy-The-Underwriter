import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import { buildEmptyMetric, type DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

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
    personal_total_income: empty,
    pfs_total_assets: empty,
    pfs_total_liabilities: empty,
    pfs_net_worth: empty,
    gcf_global_cash_flow: empty,
    gcf_dscr: empty,
    as_of_date: null,
    completeness_pct: 0,
    missing_required_keys: [],
    sources_summary: [],
    ...overrides,
  };
}

test("evaluateSbaEligibility returns conditional when missing fields", () => {
  const snapshot = makeSnapshot({});
  const result = evaluateSbaEligibility({
    snapshot,
    borrowerEntityType: null,
    useOfProceeds: null,
    dealType: null,
    loanProductType: null,
  });

  assert.equal(result.status, "conditional");
  assert.ok(result.missing.length > 0);
});

test("evaluateSbaEligibility flags ineligible entity types", () => {
  const snapshot = makeSnapshot({});
  const result = evaluateSbaEligibility({
    snapshot,
    borrowerEntityType: "Nonprofit",
    useOfProceeds: ["WORKING_CAPITAL"],
    dealType: "CRE",
    loanProductType: "SBA_7A",
  });

  assert.equal(result.status, "ineligible");
});

test("evaluateSbaEligibility flags low DSCR", () => {
  const snapshot = makeSnapshot({ dscr: { ...buildEmptyMetric(), value_num: 0.9 } });
  const result = evaluateSbaEligibility({
    snapshot,
    borrowerEntityType: "LLC",
    useOfProceeds: ["WORKING_CAPITAL"],
    dealType: "CRE",
    loanProductType: "SBA_7A",
  });

  assert.equal(result.status, "conditional");
});
