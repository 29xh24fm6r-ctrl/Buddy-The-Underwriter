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
 * SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1 (Phase 6) — the pre-render gate runs
 * Phases 2-5, suppresses blocked values and replaces weak personal-income values before render.
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

/** OmniCare-shaped facts: inconsistent 2024 BS, weak+strong 2023 personal income, sentinel GCF. */
function omniCareFacts(): GateFact[] {
  return [
    // 2024 balance sheet — TA = TE = 6.8M, components present → derived Total Liabilities = 0 is blocked
    gf({ fact_key: "SL_TOTAL_ASSETS", fact_value_num: 6_800_000 }),
    gf({ fact_key: "SL_TOTAL_EQUITY", fact_value_num: 6_800_000 }),
    gf({ fact_key: "SL_ACCOUNTS_PAYABLE", fact_value_num: 71_364 }),
    gf({ fact_key: "SL_LOANS_FROM_SHAREHOLDERS", fact_value_num: 1_930_705, confidence: 1, extractor: "taxReturnExtractor:v2:deterministic" }),
    gf({ fact_key: "SL_OTHER_LIABILITIES", fact_value_num: 284_993, confidence: 1, extractor: "taxReturnExtractor:v2:deterministic" }),
    // 2023 personal income — weak PERSONAL family vs strong DEAL/tax-return family
    gf({ fact_key: "WAGES_W2", fact_value_num: 3, fact_period_end: "2023-12-31", owner_type: "PERSONAL", owner_entity_id: "o1", fact_type: "PERSONAL_INCOME", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic" }),
    gf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 0, fact_period_end: "2023-12-31", owner_type: "PERSONAL", owner_entity_id: "o1", fact_type: "PERSONAL_INCOME", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic" }),
    gf({ fact_key: "TAXABLE_INCOME", fact_value_num: 456, fact_period_end: "2023-12-31", owner_type: "PERSONAL", owner_entity_id: "o1", fact_type: "PERSONAL_INCOME", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic" }),
    gf({ fact_key: "WAGES_W2", fact_value_num: 310_134, fact_period_end: "2023-12-31", owner_type: "DEAL", fact_type: "TAX_RETURN", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1" }),
    gf({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 282_742, fact_period_end: "2023-12-31", owner_type: "DEAL", fact_type: "TAX_RETURN", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1" }),
    gf({ fact_key: "TAXABLE_INCOME", fact_value_num: 249_968, fact_period_end: "2023-12-31", owner_type: "DEAL", fact_type: "TAX_RETURN", source_canonical_type: "PERSONAL_TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1" }),
    // GCF — sentinel-period computed cash flow
    gf({ fact_key: "CASH_FLOW_AVAILABLE", fact_value_num: 205_112, fact_period_end: "1900-01-01", fact_type: "FINANCIAL_ANALYSIS", source_canonical_type: null, confidence: 0.95, extractor: "runCashFlowAggregator:v2" }),
    gf({ fact_key: "GCF_GLOBAL_CASH_FLOW", fact_value_num: 103_865, fact_period_end: "1900-01-01", fact_type: "FINANCIAL_ANALYSIS", source_canonical_type: null, confidence: 0.85, extractor: "gcfTemplate:v3:persisted" }),
  ];
}

function fixtureInput(): ClassicSpreadInput {
  const periods = [{ date: "12/31/2024", months: 12, auditMethod: "Tax Return", stmtType: "Annual", label: "2024" }];
  return {
    dealId: "d1",
    companyName: "OmniCare",
    preparedDate: "x",
    naicsCode: null,
    naicsDescription: null,
    bankName: "Bank",
    periods,
    balanceSheet: [
      { label: "TOTAL LIABILITIES", indent: 0, isBold: true, values: [0], showPct: false },
      { label: "TOTAL NON-CURRENT LIABILITIES", indent: 0, isBold: true, values: [0], showPct: false },
      { label: "TOTAL ASSETS", indent: 0, isBold: true, values: [6_800_000], showPct: false },
    ],
    incomeStatement: [],
    cashFlow: [],
    cashFlowPeriods: [],
    ratioSections: [
      {
        title: "COVERAGE",
        rows: [
          { label: "Interest Coverage", values: [2.68], format: "ratio", decimals: 2 },
          { label: "DSCR (Traditional)", values: [2.68], format: "ratio", decimals: 2 },
          { label: "UCA Cash Flow DSCR", values: [1.5], format: "ratio", decimals: 2 },
        ],
      },
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

describe("computeCertificationDecisions — OmniCare-shaped", () => {
  const { audit, decisions } = computeCertificationDecisions(omniCareFacts(), { periods: ["2024-12-31"], gcfTaxYear: 2022 });

  it("blocks 2024 Total Liabilities (component conflict)", () => {
    assert.ok(decisions.balanceSheet.some((d) => d.periodIndex === 0 && d.rowLabels.includes("TOTAL LIABILITIES")));
    assert.equal(audit.domains.balance_sheet.status, "blocked");
  });

  it("replaces weak 2023 personal-income values with certified tax-return values", () => {
    const w2 = decisions.personalIncome.find((r) => r.year === 2023 && r.field === "wagesW2");
    const agi = decisions.personalIncome.find((r) => r.year === 2023 && r.field === "adjustedGrossIncome");
    const taxable = decisions.personalIncome.find((r) => r.year === 2023 && r.field === "taxableIncome");
    assert.equal(w2?.value, 310_134);
    assert.equal(agi?.value, 282_742);
    assert.equal(taxable?.value, 249_968);
  });

  it("blanks the sentinel-backed GCF tax-year label and numbers", () => {
    assert.ok(decisions.gcf?.blankTaxYearLabel);
    assert.deepEqual(decisions.gcf?.blankFields, ["entityCashFlowAvailable", "globalCashFlow", "globalDscr"]);
    assert.equal(audit.domains.global_cash_flow.status, "blocked");
  });

  it("suppresses interest-expense-denominated DSCR rows, keeps Interest Coverage", () => {
    assert.ok(decisions.ratios.some((r) => r.rowLabel === "DSCR (Traditional)"));
    assert.ok(decisions.ratios.some((r) => r.rowLabel === "UCA Cash Flow DSCR"));
    assert.ok(!decisions.ratios.some((r) => r.rowLabel === "Interest Coverage"));
  });

  it("audit carries the current render version, per-domain status, and suppression decisions", () => {
    assert.equal(audit.certificationVersion, CLASSIC_PDF_RENDER_VERSION);
    assert.ok(audit.suppressions.length > 0);
    assert.equal(audit.dependencyStatuses.personalIncome, "ok");
    assert.ok(audit.domains.personal_income.replacements.some((r) => r.value === 310_134));
  });
});

describe("applyCertificationToInput — render mutation", () => {
  const { decisions } = computeCertificationDecisions(omniCareFacts(), { periods: ["2024-12-31"], gcfTaxYear: 2022 });
  const input = fixtureInput();
  applyCertificationToInput(input, decisions);

  it("2024 Total Liabilities is not rendered as 0", () => {
    assert.equal(input.balanceSheet.find((r) => r.label === "TOTAL LIABILITIES")!.values[0], null);
    assert.equal(input.balanceSheet.find((r) => r.label === "TOTAL NON-CURRENT LIABILITIES")!.values[0], null);
    // total assets untouched
    assert.equal(input.balanceSheet.find((r) => r.label === "TOTAL ASSETS")!.values[0], 6_800_000);
  });

  it("W-2 = 3 / AGI = 0 / TAXABLE = 456 are replaced by certified 310,134 / 282,742 / 249,968", () => {
    const y = input.personalIncome!.years.find((yy) => yy.year === 2023)!;
    assert.equal(y.wagesW2, 310_134);
    assert.equal(y.adjustedGrossIncome, 282_742);
    assert.equal(y.taxableIncome, 249_968);
  });

  it("GCF tax-year label and sentinel-backed numbers are stripped", () => {
    assert.equal(input.globalCashFlow!.taxYear, null);
    assert.equal(input.globalCashFlow!.entityCashFlowAvailable, null);
    assert.equal(input.globalCashFlow!.globalCashFlow, null);
    assert.equal(input.globalCashFlow!.globalDscr, null);
  });

  it("mislabeled DSCR rows are blanked; Interest Coverage remains", () => {
    const cov = input.ratioSections.find((s) => s.title === "COVERAGE")!;
    assert.deepEqual(cov.rows.find((r) => r.label === "DSCR (Traditional)")!.values, [null]);
    assert.deepEqual(cov.rows.find((r) => r.label === "UCA Cash Flow DSCR")!.values, [null]);
    assert.deepEqual(cov.rows.find((r) => r.label === "Interest Coverage")!.values, [2.68]);
  });
});

describe("Phase 6 integration source guards", () => {
  it("loader runs the certification gate before returning the input", () => {
    const src = fs.readFileSync("src/lib/classicSpread/classicSpreadLoader.ts", "utf8");
    assert.match(src, /runClassicSpreadCertification/);
    assert.match(src, /applyCertificationToInput/);
    assert.match(src, /input\.certificationAudit = gate\.audit/);
  });

  it("worker and sync route persist certificationAudit into rendered_json", () => {
    assert.match(fs.readFileSync("src/lib/classicSpread/classicPdfWorker.ts", "utf8"), /certificationAudit: input\.certificationAudit/);
    assert.match(fs.readFileSync("src/app/api/deals/[dealId]/classic-spread/route.ts", "utf8"), /certificationAudit: input\.certificationAudit/);
  });

  it("the gate (core + IO) does not import or call reconcileFinancialFacts directly", () => {
    for (const file of [
      "src/lib/classicSpread/certification/certifiedSpreadGateCore.ts",
      "src/lib/classicSpread/certification/certifiedSpreadGate.ts",
    ]) {
      const code = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
        .join("\n");
      assert.ok(!/\bimport\b[\s\S]*?reconcileFinancialFacts/.test(code), `${file} imports reconcile`);
      assert.ok(!/reconcileFinancialFacts\s*\(/.test(code), `${file} calls reconcile`);
    }
  });

  it("no Supabase migration was added for this phase", () => {
    // rendered_json is jsonb — the audit needs no schema change.
    // Scoped to the classic-spread domain specifically (not a bare /certif/i
    // substring match) — "certif*" alone collides with any later, unrelated
    // migration that happens to mention certification (e.g. credit memo
    // snapshot certification-safety triggers), which isn't what this guard
    // is protecting against.
    const migrations = fs
      .readdirSync("supabase/migrations")
      .filter((f) => /certif/i.test(f) && /spread/i.test(f));
    assert.equal(migrations.length, 0);
  });
});
