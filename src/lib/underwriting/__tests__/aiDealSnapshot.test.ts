import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAiDealSnapshot, classifyFactPeriod } from "../aiDealSnapshot";

// Deal c0f6caab as it stood on 2026-09-03: three complete 1120-S years, a
// six-month interim P&L / balance sheet dated 6/30/2026, the guarantor's
// 1040s (PERSONAL owner), and a financial snapshot from the canonical chain.
const fact = (
  key: string,
  value: number,
  end: string,
  start?: string,
  owner: string = "DEAL",
) => ({ fact_key: key, fact_value_num: value, fact_period_end: end, fact_period_start: start ?? null, owner_type: owner });

const FACTS = [
  fact("GROSS_RECEIPTS", 1_344_656, "2023-12-31", "2023-01-01"),
  fact("GROSS_RECEIPTS", 1_331_712, "2024-12-31", "2024-01-01"),
  fact("GROSS_RECEIPTS", 1_378_542, "2025-12-31", "2025-01-01"),
  fact("NET_INCOME", 106_319, "2025-12-31", "2025-01-01"),
  fact("ORDINARY_BUSINESS_INCOME", 133_679, "2025-12-31", "2025-01-01"),
  fact("DEPRECIATION", 11_267, "2025-12-31", "2025-01-01"),
  fact("INTEREST_EXPENSE", 1_004, "2025-12-31", "2025-01-01"),
  fact("RENT_EXPENSE", 86_357, "2025-12-31", "2025-01-01"),
  fact("DISTRIBUTIONS", 150_749, "2025-12-31", "2025-01-01"),
  // Interim P&L and balance sheet — six months ended 6/30/2026.
  fact("TOTAL_REVENUE", 684_399.71, "2026-06-30", "2026-01-01"),
  fact("NET_INCOME", 35_746.75, "2026-06-30", "2026-01-01"),
  fact("TOTAL_ASSETS", 119_952.24, "2026-06-30", "2026-06-30"),
  // Guarantor 1040 — must never become business revenue.
  fact("TOTAL_INCOME", 325_810, "2025-12-31", "2025-01-01", "PERSONAL"),
  fact("WAGES_W2", 59_867, "2025-12-31", "2025-01-01", "PERSONAL"),
  // Sentinel-period engine outputs are ignored here (they arrive via canonical).
  fact("CF_NCADS", 232_307, "1900-01-01", "1900-01-01"),
];

const CANONICAL = {
  as_of_date: "2026-09-03",
  completeness_pct: 100,
  dscr: { value_num: 2.526 },
  gcf_dscr: { value_num: 4.397 },
  cash_flow_available: { value_num: 232_307 },
  annual_debt_service: { value_num: 91_960.88 },
  gcf_global_cash_flow: { value_num: 404_312 },
  ltv_gross: { value_num: 0.8 },
  collateral_gross_value: { value_num: 1_200_000 },
  bank_loan_total: { value_num: 960_000 },
  revenue: { value_num: 1_378_542 },
  total_assets: { value_num: 119_952.24 },
  total_liabilities: { value_num: 63_064.79 },
};

function build(overrides: Partial<Parameters<typeof buildAiDealSnapshot>[0]> = {}) {
  return buildAiDealSnapshot({
    dealId: "c0f6caab",
    borrowerName: "Buff Guys Mobile Detailing & Restoration",
    entityType: "S_CORP",
    state: "GA",
    naicsCode: "811198",
    loanAmount: 960_000,
    loanPurpose: "Purchase of owner-occupied commercial property",
    productType: "CRE_PURCHASE",
    occupancyType: "OWNER_OCCUPIED",
    facts: FACTS,
    canonical: CANONICAL,
    reconciliationStatus: "CLEAN",
    evidenceIndex: [{ docId: "d1", label: "BUSINESS_TAX_RETURN", kind: "pdf" }],
    today: new Date("2026-09-03T15:00:00Z"),
    ...overrides,
  });
}

describe("classifyFactPeriod", () => {
  it("treats a full-year span or a fiscal-year-end as annual", () => {
    assert.equal(classifyFactPeriod({ fact_period_start: "2025-01-01", fact_period_end: "2025-12-31" }), "annual");
    assert.equal(classifyFactPeriod({ fact_period_start: null, fact_period_end: "2024-12-31" }), "annual");
  });
  it("treats a partial span or a non-year-end date as interim", () => {
    assert.equal(classifyFactPeriod({ fact_period_start: "2026-01-01", fact_period_end: "2026-06-30" }), "interim");
    assert.equal(classifyFactPeriod({ fact_period_start: null, fact_period_end: "2026-06-30" }), "interim");
  });
  it("ignores sentinel and missing periods", () => {
    assert.equal(classifyFactPeriod({ fact_period_start: "1900-01-01", fact_period_end: "1900-01-01" }), null);
    assert.equal(classifyFactPeriod({ fact_period_start: null, fact_period_end: null }), null);
  });
});

describe("buildAiDealSnapshot", () => {
  it("uses the latest COMPLETE fiscal year, not the interim statement, as the latest year", () => {
    const snap = build();
    assert.equal(snap.latestYear, 2025);
    assert.deepEqual(snap.yearsAvailable, [2023, 2024, 2025]);
    assert.equal(snap.grossReceipts, 1_378_542);
    assert.equal(snap.netIncome, 106_319);
    assert.deepEqual(snap.revenueTrend, { "2023": 1_344_656, "2024": 1_331_712, "2025": 1_378_542 });
    // The old builder reported these as "2026 revenue 684k / net income 35,746".
    assert.equal((snap.revenueTrend as Record<string, number | null>)["2026"], undefined);
  });

  it("surfaces the interim period separately, annualized", () => {
    const snap = build();
    assert.equal(snap.interimPeriod.periodEnd, "2026-06-30");
    assert.equal(snap.interimPeriod.months, 6);
    assert.equal(snap.interimPeriod.revenue, 684_399.71);
    assert.equal(snap.interimPeriod.annualizedRevenue, 1_368_799);
    assert.equal(snap.interimPeriod.annualizedNetIncome, 71_494);
    assert.ok(snap.analysisNotes.some((n: string) => n.includes("PARTIAL-YEAR")));
  });

  it("passes the canonical underwriting metrics through", () => {
    const snap = build();
    assert.equal(snap.canonicalMetrics.dscr, 2.526);
    assert.equal(snap.canonicalMetrics.globalDscr, 4.397);
    assert.equal(snap.canonicalMetrics.ltvGross, 0.8);
    assert.equal(snap.canonicalMetrics.cashFlowAvailable, 232_307);
    assert.equal(snap.canonicalMetrics.annualDebtService, 91_960.88);
    assert.equal(snap.canonicalMetrics.bankLoanTotal, 960_000);
    assert.equal(snap.canonicalMetrics.collateralGrossValue, 1_200_000);
    assert.equal(snap.reconciliationStatus, "CLEAN");
    assert.equal(snap.totalLiabilities, 63_064.79);
  });

  it("never lets the guarantor's personal return stand in for business revenue", () => {
    const snap = build({
      facts: FACTS.filter((f) => f.owner_type === "PERSONAL" || f.fact_key === "TOTAL_ASSETS"),
    });
    assert.equal(snap.grossReceipts, null);
    assert.deepEqual(snap.yearsAvailable, []);
  });

  it("ignores future-dated periods and survives without a canonical snapshot", () => {
    const snap = build({
      canonical: null,
      facts: [...FACTS, fact("GROSS_RECEIPTS", 1, "2026-12-31", "2026-01-01")],
    });
    assert.equal(snap.latestYear, 2025);
    assert.equal(snap.canonicalMetrics.dscr, null);
    assert.equal(snap.totalAssets, null); // interim balance sheet is not a fiscal-year figure
  });
});
