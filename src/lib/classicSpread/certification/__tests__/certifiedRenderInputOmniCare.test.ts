import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  computeCertificationDecisions,
  applyCertificationToInput,
  type GateFact,
} from "../certifiedSpreadGateCore";
import type { ClassicSpreadInput } from "../../types";
import { CLASSIC_PDF_RENDER_VERSION } from "../../classicPdfRenderVersion";

/**
 * BUG: certification gate not reaching rendered OmniCare output.
 *
 * Asserts the FINAL ClassicSpreadInput (what the PDF renders) after the gate is applied — not
 * just the gate core. Covers the partial-application symptom: a blocked Total Liabilities must
 * also suppress the leverage/growth ratios that derive from it (Debt/Worth etc.), which the
 * original Phase 6 only did for the COVERAGE DSCR rows.
 */

function gf(over: Partial<GateFact>): GateFact {
  return {
    id: Math.random().toString(36).slice(2),
    fact_key: "SL_TOTAL_ASSETS",
    fact_value_num: 1,
    fact_period_end: "2024-12-31",
    owner_type: "DEAL",
    owner_entity_id: null,
    source_document_id: "doc",
    source_canonical_type: "BUSINESS_TAX_RETURN",
    fact_type: "TAX_RETURN",
    confidence: 0.8,
    extractor: "gemini_primary_v1",
    is_superseded: false,
    resolution_status: "inferred",
    ...over,
  };
}

function omniCareFacts(): GateFact[] {
  return [
    // 2024 balance sheet — TA = TE = 6.8M with material liability components → Total Liab blocked
    gf({ fact_key: "SL_TOTAL_ASSETS", fact_value_num: 6_800_000 }),
    gf({ fact_key: "SL_TOTAL_EQUITY", fact_value_num: 6_800_000 }),
    gf({ fact_key: "SL_ACCOUNTS_PAYABLE", fact_value_num: 71_364 }),
    gf({ fact_key: "SL_LOANS_FROM_SHAREHOLDERS", fact_value_num: 1_930_705, confidence: 1, extractor: "taxReturnExtractor:v2:deterministic" }),
    gf({ fact_key: "SL_OTHER_LIABILITIES", fact_value_num: 284_993, confidence: 1, extractor: "taxReturnExtractor:v2:deterministic" }),
    // 2023 personal income — weak PERSONAL vs strong DEAL/tax-return family
    gf({ fact_key: "WAGES_W2", fact_value_num: 3, fact_period_end: "2023-12-31", owner_type: "PERSONAL", owner_entity_id: "o1", fact_type: "PERSONAL_INCOME", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic" }),
    gf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 0, fact_period_end: "2023-12-31", owner_type: "PERSONAL", owner_entity_id: "o1", fact_type: "PERSONAL_INCOME", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic" }),
    gf({ fact_key: "TAXABLE_INCOME", fact_value_num: 456, fact_period_end: "2023-12-31", owner_type: "PERSONAL", owner_entity_id: "o1", fact_type: "PERSONAL_INCOME", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic" }),
    gf({ fact_key: "WAGES_W2", fact_value_num: 310_134, fact_period_end: "2023-12-31", owner_type: "DEAL", fact_type: "TAX_RETURN", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.8 }),
    gf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 282_742, fact_period_end: "2023-12-31", owner_type: "DEAL", fact_type: "TAX_RETURN", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.8 }),
    gf({ fact_key: "TAXABLE_INCOME", fact_value_num: 249_968, fact_period_end: "2023-12-31", owner_type: "DEAL", fact_type: "TAX_RETURN", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.8 }),
    // GCF — sentinel-period computed cash flow
    gf({ fact_key: "CASH_FLOW_AVAILABLE", fact_value_num: 205_112, fact_period_end: "1900-01-01", fact_type: "FINANCIAL_ANALYSIS", source_canonical_type: null, confidence: 0.95, extractor: "runCashFlowAggregator:v2" }),
  ];
}

function rrow(label: string, values: (number | string | null)[]) {
  return { label, values, format: "ratio" as const, decimals: 2 };
}

function fixtureInput(): ClassicSpreadInput {
  return {
    dealId: "d1",
    companyName: "OmniCare",
    preparedDate: "x",
    naicsCode: null,
    naicsDescription: null,
    bankName: "Bank",
    periods: [{ date: "12/31/2024", months: 12, auditMethod: "Tax Return", stmtType: "Annual", label: "2024" }],
    balanceSheet: [
      { label: "TOTAL LIABILITIES", indent: 0, isBold: true, values: [0], showPct: false },
      { label: "TOTAL NON-CURRENT LIABILITIES", indent: 0, isBold: true, values: [0], showPct: false },
      { label: "TOTAL ASSETS", indent: 0, isBold: true, values: [6_800_000], showPct: false },
    ],
    incomeStatement: [],
    cashFlow: [],
    cashFlowPeriods: [],
    ratioSections: [
      { title: "LEVERAGE", rows: [
        rrow("Net Worth", [6_800_000]),
        rrow("Debt / Worth", [0]),
        rrow("Debt / Tangible Net Worth", [0]),
        rrow("Total Liabilities / Total Assets", [0]),
      ] },
      { title: "COVERAGE", rows: [
        rrow("Interest Coverage", [2.68]),
        rrow("DSCR (Traditional)", [2.68]),
        rrow("UCA Cash Flow DSCR", [1.5]),
      ] },
      { title: "GROWTH", rows: [rrow("Total Liabilities Growth %", [12.3])] },
    ],
    globalCashFlow: {
      taxYear: 2022,
      entityCashFlowAvailable: 205_112,
      entityCount: 1,
      sponsors: [],
      globalCashFlow: 103_865,
      proposedAnnualDebtService: 101_250,
      globalDscr: 1.0258,
      coverageStatus: "TIGHT",
    },
    personalIncome: {
      ownerName: null,
      years: [
        { year: 2023, periodEnd: "2023-12-31", wagesW2: 3, schedCNet: null, schedENet: null, k1OrdinaryIncome: null, taxableInterest: null, ordinaryDividends: null, capitalGains: null, pensionAnnuity: null, socialSecurity: null, otherIncome: null, adjustmentsToIncome: null, adjustedGrossIncome: 0, standardDeduction: null, qbiDeduction: null, taxableIncome: 456, totalTax: null, schEGrossRents: null, schEMortgageInterest: null, schEDepreciation: null, schETotalExpenses: null, f4562Sec179: null, f4562BonusDepreciation: null, f4562TotalDepreciation: null, f8825NetIncomeLoss: null },
      ],
    },
    executiveSummary: { assets: [], liabilitiesAndNetWorth: [], incomeStatement: [] },
  };
}

function applied() {
  const input = fixtureInput();
  const { audit, decisions } = computeCertificationDecisions(omniCareFacts(), { periods: ["2024-12-31"], gcfTaxYear: 2022 });
  applyCertificationToInput(input, decisions);
  return { input, audit };
}

const lev = (input: ClassicSpreadInput, label: string) =>
  input.ratioSections.find((s) => s.title === "LEVERAGE")!.rows.find((r) => r.label === label)!.values[0];

describe("final render input — OmniCare certification applied", () => {
  it("Personal Income renders certified tax-return values, not the weak OCR stubs", () => {
    const { input } = applied();
    const y = input.personalIncome!.years.find((yy) => yy.year === 2023)!;
    assert.equal(y.wagesW2, 310_134);
    assert.equal(y.adjustedGrossIncome, 282_742);
    assert.equal(y.taxableIncome, 249_968);
  });

  it("Global Cash Flow does not render a clean Tax Year 2022 for sentinel-backed data", () => {
    const { input } = applied();
    assert.equal(input.globalCashFlow!.taxYear, null);
    assert.equal(input.globalCashFlow!.entityCashFlowAvailable, null);
    assert.equal(input.globalCashFlow!.globalCashFlow, null);
    assert.equal(input.globalCashFlow!.globalDscr, null);
  });

  it("2024 Total Liabilities is not rendered", () => {
    const { input } = applied();
    assert.equal(input.balanceSheet.find((r) => r.label === "TOTAL LIABILITIES")!.values[0], null);
    assert.equal(input.balanceSheet.find((r) => r.label === "TOTAL ASSETS")!.values[0], 6_800_000);
  });

  it("leverage ratios derived from blocked liabilities are NOT rendered as 0.00", () => {
    const { input } = applied();
    assert.equal(lev(input, "Debt / Worth"), null);
    assert.equal(lev(input, "Debt / Tangible Net Worth"), null);
    assert.equal(lev(input, "Total Liabilities / Total Assets"), null);
    assert.equal(input.ratioSections.find((s) => s.title === "GROWTH")!.rows[0].values[0], null);
    // a non-liability leverage row (Net Worth) is untouched
    assert.equal(lev(input, "Net Worth"), 6_800_000);
  });

  it("mislabeled DSCR rows are blanked; Interest Coverage is kept", () => {
    const { input } = applied();
    const cov = input.ratioSections.find((s) => s.title === "COVERAGE")!;
    assert.deepEqual(cov.rows.find((r) => r.label === "DSCR (Traditional)")!.values, [null]);
    assert.deepEqual(cov.rows.find((r) => r.label === "UCA Cash Flow DSCR")!.values, [null]);
    assert.deepEqual(cov.rows.find((r) => r.label === "Interest Coverage")!.values, [2.68]);
  });

  it("certification audit version tracks CLASSIC_PDF_RENDER_VERSION and records the suppressions", () => {
    const { audit } = applied();
    assert.equal(audit.certificationVersion, 13);
    assert.equal(CLASSIC_PDF_RENDER_VERSION, 13);
    assert.equal(audit.domains.balance_sheet.status, "blocked");
    assert.ok(audit.suppressions.some((s) => s.page === "ratios" && /liability-derived/.test(s.reason)));
  });
});

describe("rendered_json wiring — renderVersion + certificationAudit persisted", () => {
  it("loader runs the gate and attaches certificationAudit before render", () => {
    const src = fs.readFileSync("src/lib/classicSpread/classicSpreadLoader.ts", "utf8");
    assert.match(src, /runClassicSpreadCertification/);
    assert.match(src, /applyCertificationToInput/);
    assert.match(src, /input\.certificationAudit = gate\.audit/);
  });

  it("worker + sync route persist renderVersion 4 and certificationAudit into rendered_json", () => {
    for (const f of ["src/lib/classicSpread/classicPdfWorker.ts", "src/app/api/deals/[dealId]/classic-spread/route.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      assert.match(src, /renderVersion: CLASSIC_PDF_RENDER_VERSION/, `${f} stamps renderVersion`);
      assert.match(src, /certificationAudit: input\.certificationAudit/, `${f} persists certificationAudit`);
    }
  });
});
