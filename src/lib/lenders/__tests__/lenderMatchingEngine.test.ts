import { test } from "node:test";
import assert from "node:assert/strict";
import { matchLenders, type LenderProgram } from "@/lib/lenders/lenderMatchingEngine";
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

// ── Ratio-scale limits (production lender_programs.max_ltv = 0.90; snapshot ltv is 0–1) ──

const ratioSnapshot = (dscr: number, ltvNet: number) =>
  ({ dscr: { value_num: dscr }, ltv_net: { value_num: ltvNet } }) as any;

const ratioProgram = (over: Partial<LenderProgram> = {}): LenderProgram => ({
  id: "prog-1",
  lender_name: "Launch Test Lender",
  program_name: "All-Asset",
  min_dscr: 1.0,
  max_ltv: 0.9,
  ...over,
});

test("LTV limits are ratios and are reported as percentages", () => {
  // Production lender_programs row: max_ltv = 0.90; snapshot ltv_net is 0–1.
  const r = matchLenders({ snapshot: ratioSnapshot(2.5, 0.8), score: null, sbaStatus: null, assetType: null, geography: null, programs: [ratioProgram()] });
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].programId, "prog-1");
  assert.ok(r.matched[0].reasons.includes("LTV 80% within 90% limit."), r.matched[0].reasons.join(" | "));
});

test("an LTV above the program limit excludes the program with a percent message", () => {
  const r = matchLenders({ snapshot: ratioSnapshot(2.5, 1.0), score: null, sbaStatus: null, assetType: null, geography: null, programs: [ratioProgram()] });
  assert.equal(r.matched.length, 0);
  assert.deepEqual(r.excluded[0], { programId: "prog-1", lender: "Launch Test Lender", reason: "LTV 100% above 90%." });
});

test("NUMERIC limits arriving as strings from PostgREST still apply", () => {
  const r = matchLenders({
    snapshot: ratioSnapshot(0.9, 0.5),
    score: null, sbaStatus: null, assetType: null, geography: null,
    programs: [ratioProgram({ min_dscr: "1.00" as any, max_ltv: "0.90" as any })],
  });
  assert.equal(r.matched.length, 0);
  assert.match(r.excluded[0].reason, /DSCR 0\.90 below 1\.00/);
});
