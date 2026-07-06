/**
 * SPEC-FINENGINE-COMPLETE-DERIVATION-1 — fact-over-formula priority,
 * comprehensive balance-sheet derivations, and per-period ADS/DSCR rendering.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFinancialModel, type FactInput } from "../buildFinancialModel";
import { renderFromFinancialModel } from "../renderer/v2Adapter";

const F = (t: string, k: string, v: number, pe = "2022-12-31"): FactInput => ({
  fact_type: t, fact_key: k, fact_value_num: v, fact_period_end: pe, confidence: 0.8,
});

function cell(vm: ReturnType<typeof renderFromFinancialModel>, rowKey: string, pe = "2022-12-31"): number | null {
  for (const s of vm.sections) {
    const r = s.rows.find((row) => row.key === rowKey);
    if (r) return r.valueByCol[pe] ?? null;
  }
  return null;
}

// OmniCare FY2022: TOTAL_DEDUCTIONS (1,983,113) is the authoritative operating
// expense aggregate; the formula sum of visible line items is only ~$588K.
const OMNICARE_2022: FactInput[] = [
  F("TAX_RETURN", "GROSS_RECEIPTS", 7069774),
  F("TAX_RETURN", "COST_OF_GOODS_SOLD", 5086661),
  F("TAX_RETURN", "TOTAL_DEDUCTIONS", 1983113),
  F("TAX_RETURN", "OFFICER_COMPENSATION", 324684),
  F("TAX_RETURN", "DEPRECIATION", 151225),
  F("TAX_RETURN", "RENT_EXPENSE", 112800),
  F("TAX_RETURN", "ORDINARY_BUSINESS_INCOME", 0),
  F("TAX_RETURN", "NET_INCOME", 0),
];

describe("SPEC-FINENGINE-COMPLETE-DERIVATION-1", () => {
  it("fact-over-formula: authoritative aggregate wins over the line-item formula sum", () => {
    const vm = renderFromFinancialModel(buildFinancialModel("d", OMNICARE_2022));
    assert.equal(cell(vm, "TOTAL_OPERATING_EXPENSES"), 1983113, "uses TOTAL_DEDUCTIONS, not the ~588K formula sum");
  });

  it("resolves the EBITDA vs Net Profit contradiction (Net Profit ≤ EBITDA when dep,int ≥ 0)", () => {
    const vm = renderFromFinancialModel(buildFinancialModel("d", OMNICARE_2022));
    const nop = cell(vm, "NET_OPERATING_PROFIT");
    const np = cell(vm, "NET_PROFIT");
    const ebitda = cell(vm, "EBITDA");
    assert.equal(nop, 0, "Net Operating Profit = GrossProfit − full OpEx = 0");
    assert.equal(np, 0, "Net Profit agrees with net income base");
    assert.equal(ebitda, 151225, "EBITDA = 0 + depreciation");
    assert.ok((np ?? 0) <= (ebitda ?? 0), "Net Profit must never exceed EBITDA when add-backs are ≥ 0");
  });

  it("formula-only rows without a raw value still compute (GROSS_PROFIT)", () => {
    const vm = renderFromFinancialModel(buildFinancialModel("d", OMNICARE_2022));
    assert.equal(cell(vm, "GROSS_PROFIT"), 7069774 - 5086661, "revenue − COGS via formula");
  });

  it("derives Total Liabilities from components (incl. long-term debt) when no raw fact", () => {
    const facts = [
      F("TAX_RETURN", "SL_ACCOUNTS_PAYABLE", 31669, "2023-12-31"),
      F("TAX_RETURN", "SL_OPERATING_CURRENT_LIABILITIES", 10669, "2023-12-31"),
      F("TAX_RETURN", "SL_LOANS_FROM_SHAREHOLDERS", 1730705, "2023-12-31"),
      F("TAX_RETURN", "SL_MORTGAGES_NOTES_BONDS", 1730705, "2023-12-31"),
      F("TAX_RETURN", "SL_TOTAL_ASSETS", 3003188, "2023-12-31"),
    ];
    const p = buildFinancialModel("d", facts).periods[0];
    assert.equal(p.balance.totalLiabilities, 1773043, "AP + OCL + deduped LTD");
    assert.equal(p.balance.equity, 3003188 - 1773043, "Net Worth derived after TL");
  });

  it("derives Net Fixed Assets = PPE gross − accumulated depreciation", () => {
    const facts = [
      F("TAX_RETURN", "SL_PPE_GROSS", 424703),
      F("TAX_RETURN", "SL_ACCUMULATED_DEPRECIATION", 306884),
      F("TAX_RETURN", "SL_TOTAL_ASSETS", 3268740),
    ];
    const p = buildFinancialModel("d", facts).periods[0];
    assert.equal(p.balance.netFixedAssets, 117819);
    assert.equal(p.balance.totalNonCurrentAssets, 117819);
  });

  it("a raw extracted balance total is NOT overridden by the derivation", () => {
    const facts = [
      F("TAX_RETURN", "SL_TOTAL_LIABILITIES", 3268740), // present (even if wrong) → kept, not derived
      F("TAX_RETURN", "SL_ACCOUNTS_PAYABLE", 100),
    ];
    const p = buildFinancialModel("d", facts).periods[0];
    assert.equal(p.balance.totalLiabilities, 3268740, "derivation only fills a MISSING total");
  });

  it("injects ADS per period so the DSCR row renders a value", () => {
    const vm = renderFromFinancialModel(buildFinancialModel("d", OMNICARE_2022), "d", { annualDebtService: 101250 });
    const dscr = cell(vm, "R_DSCR");
    assert.ok(dscr !== null, "DSCR computes once ADS is injected");
    // CFADS = EBITDA(151225) − capex(0); DSCR = 151225 / 101250 ≈ 1.49
    assert.ok(Math.abs((dscr ?? 0) - 1.4936) < 0.01, `DSCR ≈ 1.49, got ${dscr}`);
  });

  it("without an ADS override the DSCR row stays null (read-only callers unaffected)", () => {
    const vm = renderFromFinancialModel(buildFinancialModel("d", OMNICARE_2022));
    assert.equal(cell(vm, "R_DSCR"), null);
  });
});
