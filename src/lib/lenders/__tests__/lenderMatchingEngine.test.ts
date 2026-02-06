import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLenders } from "@/lib/lenders/lenderMatchingEngine";
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
    as_of_date: null,
    completeness_pct: 80,
    missing_required_keys: [],
    sources_summary: [],
    ...overrides,
  };
}

test("matchLenders filters by DSCR and LTV", () => {
  const snap = snapshotWith({
    dscr: { ...buildEmptyMetric(), value_num: 1.2 },
    ltv_net: { ...buildEmptyMetric(), value_num: 70 },
  });

  const result = matchLenders({
    snapshot: snap,
    score: 80,
    sbaStatus: "eligible",
    assetType: "CRE",
    geography: "CA",
    programs: [
      { id: "1", lender_name: "Lender A", min_dscr: 1.1, max_ltv: 75, sba_only: false },
      { id: "2", lender_name: "Lender B", min_dscr: 1.3, max_ltv: 65, sba_only: false },
    ],
  });

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].lender, "Lender A");
  assert.equal(result.excluded.length, 1);
});
