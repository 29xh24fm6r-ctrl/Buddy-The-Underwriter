import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots } from "@/lib/deals/financialSnapshotDiff";
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

test("diffSnapshots returns changed metrics", () => {
  const snapA = makeSnapshot({ noi_ttm: metric(100) });
  const snapB = makeSnapshot({ noi_ttm: metric(200) });

  const diff = diffSnapshots({ fromId: "a", toId: "b", from: snapA, to: snapB });
  const metrics = diff.diffs.map((d) => d.metric);

  assert.ok(metrics.includes("noi_ttm"));
});
