import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { auditClassicSpread, type AuditInput, type SpreadAuditResult } from "../audit/spreadAccuracyAudit";
import type { PeriodMaps } from "../classicSpreadRatios";
import type { FinancialRow, GlobalCashFlowSection } from "../types";
import {
  resolveBalanceSheetSourceLines,
  provenanceSnippet,
  type SourceLineFact,
} from "../audit/balanceSheetSourceLineResolver";
import { resolveBalanceSheet, type Facts } from "../audit/statementTruthResolver";
import {
  buildClassicSpreadCertificationSummary,
  type ClassicSpreadCertificationSummary,
} from "../certification/certificationSummary";
import type { ClassicSpreadCertificationAudit } from "../certification/certifiedSpreadGateCore";
import { CLASSIC_PDF_RENDER_VERSION } from "../classicPdfRenderVersion";

import { parseGeminiResponse } from "@/lib/financialSpreads/extractors/gemini/geminiResponseParser";
import { planFactWriteRecomputeSpreadTypes } from "@/lib/financialSpreads/factWriteRecomputePlan";
import {
  isT12Eligible,
  isOptionalSpreadType,
  filterOptionalSpreadsForDefaultRecompute,
} from "@/lib/spreads/t12Eligibility";
import { ALL_SPREAD_TYPES, type SpreadType } from "@/lib/financialSpreads/types";

/**
 * SPEC-SPREAD-SYSTEM-PERFECTION-HARDENING-1 (Phase 3) — certification regression net.
 *
 * Synthetic OmniCare-SHAPED fixtures (no production DB, no historical-fact mutation) that exercise
 * the REAL pure pipeline — spreadAccuracyAudit → certificationSummary, the balance-sheet source-line
 * resolver, the Gemini-primary parser (Phase 1), and the internal fact-write recompute planner
 * (Phase 2) — and prove the system stays accurate and FAILS CLOSED before we reprocess any loan.
 *
 * These tests only ASSERT existing behavior; they do not weaken the audit, the certification summary,
 * or review actions.
 */

// ── builders ─────────────────────────────────────────────────────────────────
function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}
function row(label: string, values: (number | null)[]): FinancialRow {
  return { label, indent: 0, isBold: true, values, showPct: false };
}
// Provenance-carrying fixture fact (as the extractors write it).
const f = (fact_key: string, fact_value_num: number, fact_period_end: string, snippet: string, confidence = 0.6): SourceLineFact => ({
  fact_key, fact_value_num, fact_period_end, confidence,
  provenance: { citations: [{ page: null, snippet }], raw_snippets: [snippet] },
});

// Wrap a real accuracy result into the cert-gate audit shape (domains default clean).
function certAudit(
  accuracy: SpreadAuditResult,
  domainStatuses: ("clean" | "caveated" | "blocked")[] = ["clean", "clean", "clean", "clean"],
): ClassicSpreadCertificationAudit {
  return {
    certificationVersion: CLASSIC_PDF_RENDER_VERSION,
    domains: {
      balance_sheet: { status: domainStatuses[0]!, blocked: [] },
      personal_income: { status: domainStatuses[1]!, replacements: [] },
      global_cash_flow: { status: domainStatuses[2]!, preliminary: false, blocked: [] },
      ratios: { status: domainStatuses[3]!, suppressed: [] },
    },
    dependencyStatuses: { personalIncome: "ok" },
    suppressions: [],
    spreadAccuracy: accuracy,
  };
}
const summaryFor = (
  accuracy: SpreadAuditResult,
  opts: { domainStatuses?: ("clean" | "caveated" | "blocked")[]; openReviewActionCount?: number; globalCashFlow?: GlobalCashFlowSection | null } = {},
): ClassicSpreadCertificationSummary =>
  buildClassicSpreadCertificationSummary({
    certified: true,
    audit: certAudit(accuracy, opts.domainStatuses),
    openReviewActionCount: opts.openReviewActionCount ?? 0,
    globalCashFlow: opts.globalCashFlow,
  });

// A clean, fully-footing annual tax-return balance sheet (one period).
//   TCA 200,000 = Cash 100,000 + Net AR 45,000 + Inventory 30,000 + Other CA 25,000
//   TNCA 300,000 = net PPE (400,000 − 100,000)
//   TA 500,000;  TCL 70,000 = AP 40,000 + Wages 10,000 + Other CL 20,000
//   TNCL 180,000 = Mortgages 150,000 + Shareholder loans 30,000;  TL 250,000;  NW 250,000
function cleanAnnualBalanceSheet(): AuditInput {
  return {
    periods: [{ iso: "2023-12-31", label: "2023" }],
    byPeriod: pm({
      "2023-12-31": {
        SL_CASH: 100_000,
        SL_AR_GROSS: 50_000,
        SL_AR_ALLOWANCE: 5_000,
        SL_INVENTORY: 30_000,
        SL_OTHER_CURRENT_ASSETS: 25_000,
        SL_PPE_GROSS: 400_000,
        SL_ACCUMULATED_DEPRECIATION: 100_000,
        SL_TOTAL_ASSETS: 500_000,
        SL_ACCOUNTS_PAYABLE: 40_000,
        SL_WAGES_PAYABLE: 10_000,
        SL_OPERATING_CURRENT_LIABILITIES: 20_000,
        SL_MORTGAGES_NOTES_BONDS: 150_000,
        SL_LOANS_FROM_SHAREHOLDERS: 30_000,
        SL_TOTAL_LIABILITIES: 250_000,
        SL_TOTAL_EQUITY: 250_000,
      },
    }),
    balanceSheet: [
      row("Net Accounts Receivable", [45_000]),
      row("TOTAL CURRENT ASSETS", [200_000]),
      row("TOTAL NON-CURRENT ASSETS", [300_000]),
      row("TOTAL ASSETS", [500_000]),
      row("TOTAL CURRENT LIABILITIES", [70_000]),
      row("TOTAL NON-CURRENT LIABILITIES", [180_000]),
      row("TOTAL LIABILITIES", [250_000]),
      row("TOTAL NET WORTH", [250_000]),
    ],
    incomeStatement: [],
    cashFlow: [],
  };
}

// ── 1 + 4. HAPPY PATH: clean annual BS foots, zero audit blockers, cert CERTIFIED ───────────────
describe("happy path — clean annual tax-return balance sheet certifies", () => {
  const accuracy = auditClassicSpread(cleanAnnualBalanceSheet());

  it("balance sheet foots: spreadAccuracyAudit has zero findings and is clean", () => {
    assert.equal(accuracy.status, "clean");
    assert.equal(accuracy.summary.blockers, 0);
    assert.equal(accuracy.findings.length, 0, `unexpected findings: ${JSON.stringify(accuracy.findings)}`);
    assert.equal(accuracy.summary.unmappedFactKeys, 0);
  });

  it("certificationSummary reaches CERTIFIED for the intended reason (all domains clean, no actions)", () => {
    const s = summaryFor(accuracy, { openReviewActionCount: 0 });
    assert.equal(s.status, "certified");
    assert.equal(s.blockerCount, 0);
    assert.equal(s.openReviewActionCount, 0);
    assert.equal(s.certifiedCount, 4);
  });

  it("a single benign warning keeps it PRELIMINARY, never silently certified", () => {
    // Add one unmapped source key → a warning (missing_source_mapping), no blocker.
    const input = cleanAnnualBalanceSheet();
    input.byPeriod.get("2023-12-31")!.set("SL_DEFERRED_TAX_ASSET", 1_234);
    const acc = auditClassicSpread(input);
    assert.equal(acc.summary.blockers, 0);
    assert.ok(acc.summary.warnings >= 1);
    assert.equal(summaryFor(acc).status, "preliminary");
  });
});

// ── 2. Schedule L other current liabilities / shareholder loans fold into TCL/TL ────────────────
describe("Schedule L OCL + shareholder loans", () => {
  it("other current liabilities (provenance-remapped) and shareholder loans foot into the totals", () => {
    // Source facts as extracted: 'other current liabilities' lands under SL_OTHER_LIABILITIES.
    const facts = [
      f("SL_ACCOUNTS_PAYABLE", 40_000, "2023-12-31", "Line 16: 40,000 Accounts payable"),
      f("SL_OTHER_LIABILITIES", 20_000, "2023-12-31", "Line 18: 20,000 Other current liabilities (Statement 2)"),
      f("SL_LOANS_FROM_SHAREHOLDERS", 30_000, "2023-12-31", "Line 19: 30,000 Loans from shareholders"),
      f("SL_MORTGAGES_NOTES_BONDS", 150_000, "2023-12-31", "Line 20: 150,000 Mortgages, notes, bonds payable in 1 year or more"),
    ];
    const { facts: out } = resolveBalanceSheetSourceLines(facts);
    // The OCL line is reclassified to a CURRENT liability by its source line (Phase-1 provenance).
    assert.ok(out.some((x) => x.fact_key === "SL_OPERATING_CURRENT_LIABILITIES" && x.fact_value_num === 20_000));

    const rec: Facts = {};
    for (const x of out) if (x.fact_value_num != null) rec[x.fact_key] = x.fact_value_num;
    const r = resolveBalanceSheet(rec);
    // TCL = AP 40,000 + OCL 20,000 = 60,000; TL = 60,000 + shareholder loans 30,000 + mortgages 150,000 = 240,000
    assert.equal(r.totalCurrentLiabilities.value, 60_000);
    assert.equal(r.totalLiabilities.value, 240_000);
  });
});

// ── 3. QuickBooks-style company-prepared balance sheet (Phase-1 detail keys) ────────────────────
describe("QuickBooks-style company-prepared balance sheet", () => {
  it("audits clean using the Phase-1 current-asset/-liability detail keys", () => {
    const input: AuditInput = {
      periods: [{ iso: "2024-12-31", label: "2024" }],
      byPeriod: pm({
        "2024-12-31": {
          SL_CASH: 80_000,
          SL_OTHER_CURRENT_ASSETS: 20_000, // QuickBooks "Other current assets" (Phase 1 key)
          SL_TOTAL_ASSETS: 100_000,
          SL_ACCOUNTS_PAYABLE: 15_000,
          SL_WAGES_PAYABLE: 5_000, // payroll liabilities (Phase 1 key)
          SL_OPERATING_CURRENT_LIABILITIES: 10_000, // other current liabilities (Phase 1 key)
          SL_TOTAL_LIABILITIES: 30_000,
          SL_TOTAL_EQUITY: 70_000,
        },
      }),
      balanceSheet: [
        row("TOTAL CURRENT ASSETS", [100_000]),
        row("TOTAL ASSETS", [100_000]),
        row("TOTAL CURRENT LIABILITIES", [30_000]),
        row("TOTAL LIABILITIES", [30_000]),
        row("TOTAL NET WORTH", [70_000]),
      ],
      incomeStatement: [],
      cashFlow: [],
    };
    const acc = auditClassicSpread(input);
    assert.equal(acc.summary.blockers, 0);
    assert.equal(acc.summary.unmappedFactKeys, 0, "Phase-1 QuickBooks keys must be mapped, not 'unmapped'");
    assert.equal(summaryFor(acc).status, "certified");
  });
});

// ── 4(fail-closed) + 4(scope item 4 missing detail → review action) ─────────────────────────────
describe("fail closed — missing/ambiguous component detail blocks certification", () => {
  it("blank Total Liabilities while components exist → blocker → cert BLOCKED with a REQUEST_SOURCE_DETAIL action", () => {
    const input = cleanAnnualBalanceSheet();
    // Company-prepared interim hid the consolidated total — render Total Liabilities blank.
    input.balanceSheet = input.balanceSheet.map((r) =>
      r.label === "TOTAL LIABILITIES" ? row("TOTAL LIABILITIES", [null]) : r,
    );
    const acc = auditClassicSpread(input);
    assert.equal(acc.status, "blocker");
    assert.ok(acc.summary.blockers >= 1);

    const s = summaryFor(acc, { openReviewActionCount: 1 });
    assert.equal(s.status, "blocked");
    assert.ok(s.remainingRequiredActions.length >= 1, "a missing component must surface a required review action");
    assert.ok(
      s.remainingRequiredActions.some((a) => a.action === "REQUEST_SOURCE_DETAIL"),
      "missing source detail becomes a REQUEST_SOURCE_DETAIL review action",
    );
    assert.notEqual(s.status, "certified");
  });

  it("fails closed to BLOCKED when the certification gate did not complete", () => {
    const s = buildClassicSpreadCertificationSummary({ certified: false, audit: null });
    assert.equal(s.status, "blocked");
  });
});

// ── 5 + (P1×P2 interaction). Provenance-backed AR / OCL remap from Gemini-primary facts ──────────
describe("provenance-backed AR/OCL remap (Gemini-primary → resolver)", () => {
  const toSourceLineFact = (item: { factKey: string; value: number; periodEnd: string | null; provenance: unknown }): SourceLineFact => ({
    fact_key: item.factKey, fact_value_num: item.value, fact_period_end: item.periodEnd, provenance: item.provenance,
  });

  it("an interim AR line parsed by the Gemini-primary parser remaps to AR (not Total Current Assets)", () => {
    const { items } = parseGeminiResponse({
      rawJson: {
        facts: { SL_CASH: 198_693, SL_TOTAL_CURRENT_ASSETS: 3_097_345 },
        evidence: { SL_TOTAL_CURRENT_ASSETS: "Accounts receivable" },
      },
      expectedKeys: ["SL_CASH", "SL_TOTAL_CURRENT_ASSETS"],
      docType: "BALANCE_SHEET",
      documentId: "doc-omni-interim",
      factType: "BALANCE_SHEET",
      periodStart: "2026-06-30",
      periodEnd: "2026-06-30",
    });
    const tca = items.find((i) => i.factKey === "SL_TOTAL_CURRENT_ASSETS")!;
    assert.ok(provenanceSnippet(tca.provenance).includes("Accounts receivable"));

    const { facts: out, audit } = resolveBalanceSheetSourceLines(items.map(toSourceLineFact));
    const a = audit.find((x) => x.originalKey === "SL_TOTAL_CURRENT_ASSETS" && x.periodEnd === "2026-06-30");
    assert.ok(a, "Gemini-primary provenance must drive the resolver");
    assert.equal(a!.code, "INTERIM_AR_REMAPPED");
    assert.ok(out.some((x) => x.fact_key === "SL_AR_GROSS" && x.fact_value_num === 3_097_345));
  });

  it("Phase-1 enables the correction: the SAME parser output WITHOUT evidence cannot be remapped", () => {
    const { items } = parseGeminiResponse({
      rawJson: { facts: { SL_TOTAL_CURRENT_ASSETS: 3_097_345 } }, // legacy flat shape, no evidence
      expectedKeys: ["SL_TOTAL_CURRENT_ASSETS"],
      docType: "BALANCE_SHEET",
      documentId: "doc-omni-interim",
      factType: "BALANCE_SHEET",
      periodStart: "2026-06-30",
      periodEnd: "2026-06-30",
    });
    assert.equal(provenanceSnippet(items[0].provenance), "");
    const { audit } = resolveBalanceSheetSourceLines(items.map(toSourceLineFact));
    assert.equal(audit.length, 0, "no provenance ⇒ no remap (resolver never uses a blind numeric heuristic)");
  });
});

// ── 6. No T12 required for SBA/conventional annual-statement borrower (#556 + Phase 2) ──────────
describe("no T12 required for an SBA / conventional annual-statement borrower", () => {
  it("T12 is never eligible for CONVENTIONAL or SBA deal types", () => {
    for (const deal_type of ["CONVENTIONAL", "SBA", "SBA_7A", "SBA_504"]) {
      assert.equal(isT12Eligible({ deal_type, has_monthly_statements: false }).eligible, false);
      // even WITH monthly statements, CONVENTIONAL/SBA never source canonical facts from T12
      assert.equal(isT12Eligible({ deal_type, has_monthly_statements: true }).eligible, false);
    }
  });

  it("default recompute (#556) drops T12 without a real source", () => {
    const defaulted = filterOptionalSpreadsForDefaultRecompute([...ALL_SPREAD_TYPES], { hasOptionalSource: false });
    assert.ok(!defaulted.includes("T12" as SpreadType));
  });

  it("Phase-2 internal fact-write plan excludes T12 and GCF for an annual deal with no source / prereqs", () => {
    const plan = planFactWriteRecomputeSpreadTypes({ hasT12Source: false, gcfPrerequisitesReady: false });
    assert.deepEqual(plan, ["BALANCE_SHEET"]);
    assert.ok(!plan.includes("T12" as SpreadType));
    assert.ok(!plan.includes("GLOBAL_CASH_FLOW" as SpreadType));
    assert.deepEqual(plan.filter((t) => isOptionalSpreadType(t)), []);
  });

  it("Phase-2 plan admits T12 only with a real source, and GCF only when prereqs are ready", () => {
    assert.ok(planFactWriteRecomputeSpreadTypes({ hasT12Source: true, gcfPrerequisitesReady: false }).includes("T12" as SpreadType));
    assert.ok(planFactWriteRecomputeSpreadTypes({ hasT12Source: false, gcfPrerequisitesReady: true }).includes("GLOBAL_CASH_FLOW" as SpreadType));
  });
});

// ── 7. GCF stays preliminary/blocked while the underlying spread certification is blocked ───────
describe("GCF never certifies while the spread is blocked", () => {
  const blockedAccuracy = (): SpreadAuditResult => {
    const input = cleanAnnualBalanceSheet();
    input.balanceSheet = input.balanceSheet.map((r) =>
      r.label === "TOTAL LIABILITIES" ? row("TOTAL LIABILITIES", [null]) : r,
    );
    return auditClassicSpread(input); // contains a balance-sheet blocker
  };

  it("an incomplete GCF section is BLOCKED and the overall spread stays BLOCKED", () => {
    const gcf: GlobalCashFlowSection = {
      taxYear: 2023, entityCashFlowAvailable: null, entityCount: 1, sponsors: [],
      globalCashFlow: null, proposedAnnualDebtService: null, globalDscr: null, coverageStatus: "UNKNOWN",
    };
    const s = summaryFor(blockedAccuracy(), { globalCashFlow: gcf, openReviewActionCount: 1 });
    assert.equal(s.status, "blocked");
    assert.equal(s.domains.globalCashFlow.status, "blocked");
    assert.notEqual(s.domains.globalCashFlow.status, "certified");
  });

  it("a DERIVED GCF section reads PRELIMINARY and the spread still cannot certify while a blocker remains", () => {
    const gcf: GlobalCashFlowSection = {
      taxYear: 2023, entityCashFlowAvailable: 120_000, entityCount: 1, sponsors: [],
      globalCashFlow: 120_000, proposedAnnualDebtService: 80_000, globalDscr: 1.5, coverageStatus: "ADEQUATE",
      entityCashFlowComputed: true, entityCashFlowBasis: "EBITDA", entityCashFlowSourcePeriod: "2023",
    };
    const s = summaryFor(blockedAccuracy(), { globalCashFlow: gcf, openReviewActionCount: 1 });
    assert.equal(s.domains.globalCashFlow.status, "preliminary", "derived GCF is preliminary, never certified");
    assert.equal(s.status, "blocked", "a remaining BS blocker keeps the whole spread blocked");
  });
});
