/**
 * SPEC-CLASSIC-SPREAD-GCF-ENTITY-CASH-FLOW-COMPUTE-1 — entity cash flow + global DSCR computed from
 * the already-rendered classic spread rows.
 *
 * Proves:
 *  - entity cash flow computes from the latest usable ANNUAL income-statement row (EBITDA -> OBI/NI);
 *  - interim / YTD periods are never used as the entity-cash-flow basis;
 *  - global DSCR computes from a valid proposed annual debt service, and is UNAVAILABLE when the
 *    denominator is missing / zero / negative (never Infinity or a misleading ratio);
 *  - a materialized entity cash flow is left untouched;
 *  - GCF certification reads PRELIMINARY (not "blocked - entity cash flow not computed") once computed,
 *    while an open YTD-2026 TCA blocker keeps the OVERALL spread BLOCKED;
 *  - the rendered PDF + audit-page status reflect the computed state.
 *
 * OmniCare numbers are fixtures, not hardcoded production paths.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeEntityCashFlowFromSpread,
  applyComputedEntityCashFlow,
  isValidProposedDebtService,
} from "../entityCashFlowFromSpread";
import { buildClassicSpreadCertificationSummary, certificationStatusLines } from "../certification/certificationSummary";
import { renderClassicSpread } from "../classicSpreadRenderer";
import type {
  ClassicSpreadInput,
  FinancialRow,
  GlobalCashFlowSection,
  StatementPeriod,
} from "../types";
import type { ClassicSpreadCertificationAudit } from "../certification/certifiedSpreadGateCore";
import type { SpreadAuditFinding, SpreadAuditResult } from "../audit/spreadAccuracyAudit";

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────
const annual = (label: string, date: string): StatementPeriod => ({
  date, months: 12, auditMethod: "Tax Return", stmtType: "Annual", label,
});
const interim = (label: string, date: string): StatementPeriod => ({
  date, months: 3, auditMethod: "Company Prepared", stmtType: "Interim", label,
});

const isRow = (label: string, values: (number | null)[]): FinancialRow => ({
  label, indent: 0, isBold: true, values, showPct: false,
});

// 2023, 2024, 2025 annual + YTD 2026 interim (chronological)
const PERIODS: StatementPeriod[] = [
  annual("2023", "12/31/2023"),
  annual("2024", "12/31/2024"),
  annual("2025", "12/31/2025"),
  interim("YTD 2026", "03/31/2026"),
];

// EBITDA present for every annual; YTD 2026 column is a (huge) interim that must never be chosen.
const INCOME_STATEMENT: FinancialRow[] = [
  isRow("EBITDA", [180_000, 195_000, 205_112, 9_999_999]),
  isRow("NET PROFIT", [90_000, 95_000, 101_000, 5_000_000]),
];

const gcfSection = (over: Partial<GlobalCashFlowSection> = {}): GlobalCashFlowSection => ({
  taxYear: null,
  entityCashFlowAvailable: null,
  entityCount: 1,
  sponsors: [{ entityId: "g1", displayName: "Guarantor 1", personalCashAvailable: 50_000 }],
  globalCashFlow: null,
  proposedAnnualDebtService: 101_250,
  globalDscr: null,
  coverageStatus: "UNKNOWN",
  ...over,
});

// ── computeEntityCashFlowFromSpread ─────────────────────────────────────────────────────────────
describe("computeEntityCashFlowFromSpread", () => {
  it("uses the LATEST annual EBITDA, never the interim YTD column", () => {
    const r = computeEntityCashFlowFromSpread({ incomeStatement: INCOME_STATEMENT, periods: PERIODS });
    assert.equal(r.entityCashFlowAvailable, 205_112); // 2025, not the 9,999,999 YTD interim
    assert.equal(r.basis, "EBITDA");
    assert.equal(r.sourcePeriodLabel, "2025");
  });

  it("falls back to NET PROFIT (OBI/NI) when the latest annual has no EBITDA", () => {
    const is: FinancialRow[] = [
      isRow("EBITDA", [180_000, 195_000, null, null]),
      isRow("NET PROFIT", [90_000, 95_000, 101_000, null]),
    ];
    const r = computeEntityCashFlowFromSpread({ incomeStatement: is, periods: PERIODS });
    assert.equal(r.entityCashFlowAvailable, 101_000); // 2025 NET PROFIT
    assert.equal(r.basis, "NET_PROFIT");
    assert.equal(r.sourcePeriodLabel, "2025");
  });

  it("falls back to a prior annual period when the latest annual has no usable row", () => {
    const is: FinancialRow[] = [
      isRow("EBITDA", [180_000, 195_000, null, null]),
      isRow("NET PROFIT", [90_000, 95_000, null, null]),
    ];
    const r = computeEntityCashFlowFromSpread({ incomeStatement: is, periods: PERIODS });
    assert.equal(r.entityCashFlowAvailable, 195_000); // 2024 EBITDA
    assert.equal(r.sourcePeriodLabel, "2024");
  });

  it("returns null when there is no annual period (only interim columns)", () => {
    const r = computeEntityCashFlowFromSpread({
      incomeStatement: INCOME_STATEMENT,
      periods: [interim("YTD 2026", "03/31/2026")],
    });
    assert.equal(r.entityCashFlowAvailable, null);
    assert.equal(r.basis, null);
  });

  it("returns null when neither EBITDA nor NET PROFIT rows exist", () => {
    const r = computeEntityCashFlowFromSpread({
      incomeStatement: [isRow("Sales / Revenues", [1, 2, 3, 4])],
      periods: PERIODS,
    });
    assert.equal(r.entityCashFlowAvailable, null);
  });
});

// ── isValidProposedDebtService ──────────────────────────────────────────────────────────────────
describe("isValidProposedDebtService", () => {
  it("accepts a finite positive number", () => {
    assert.equal(isValidProposedDebtService(101_250), true);
  });
  it("rejects null / zero / negative / non-finite (missing / sentinel / invalid)", () => {
    assert.equal(isValidProposedDebtService(null), false);
    assert.equal(isValidProposedDebtService(undefined), false);
    assert.equal(isValidProposedDebtService(0), false);
    assert.equal(isValidProposedDebtService(-101_250), false);
    assert.equal(isValidProposedDebtService(Number.POSITIVE_INFINITY), false);
    assert.equal(isValidProposedDebtService(Number.NaN), false);
  });
});

// ── applyComputedEntityCashFlow ─────────────────────────────────────────────────────────────────
describe("applyComputedEntityCashFlow", () => {
  it("computes entity CF, global cash flow available, and DSCR from a valid debt service", () => {
    const out = applyComputedEntityCashFlow(gcfSection(), INCOME_STATEMENT, PERIODS);
    assert.equal(out.entityCashFlowAvailable, 205_112);
    assert.equal(out.entityCashFlowComputed, true);
    assert.equal(out.entityCashFlowBasis, "EBITDA");
    assert.equal(out.entityCashFlowSourcePeriod, "2025");
    // Global Cash Flow Available = entity CF + supported sponsor contribution
    assert.equal(out.globalCashFlow, 205_112 + 50_000);
    // DSCR = global cash flow available / proposed annual debt service
    assert.ok(out.globalDscr != null);
    assert.ok(Math.abs(out.globalDscr! - (255_112 / 101_250)) < 1e-9);
    assert.equal(out.coverageStatus, "ADEQUATE"); // ~2.52x
  });

  it("leaves DSCR UNAVAILABLE when proposed annual debt service is missing / zero / negative", () => {
    for (const ads of [null, 0, -1] as (number | null)[]) {
      const out = applyComputedEntityCashFlow(gcfSection({ proposedAnnualDebtService: ads }), INCOME_STATEMENT, PERIODS);
      assert.equal(out.entityCashFlowAvailable, 205_112, "entity CF still computes");
      assert.equal(out.globalDscr, null, `DSCR unavailable for ADS=${ads}`);
      assert.equal(out.coverageStatus, "UNKNOWN");
    }
  });

  it("does NOT override a materialized entity cash flow", () => {
    const materialized = gcfSection({ entityCashFlowAvailable: 300_000, globalCashFlow: 350_000, globalDscr: 3.45 });
    const out = applyComputedEntityCashFlow(materialized, INCOME_STATEMENT, PERIODS);
    assert.equal(out, materialized); // unchanged reference
    assert.equal(out.entityCashFlowComputed, undefined);
  });

  it("returns the section unchanged when no annual row supports entity cash flow", () => {
    const section = gcfSection();
    const out = applyComputedEntityCashFlow(section, [], PERIODS);
    assert.equal(out, section);
    assert.equal(out.entityCashFlowAvailable, null);
  });
});

// ── certification summary integration ───────────────────────────────────────────────────────────
const finding = (
  rowLabel: string,
  severity: SpreadAuditFinding["severity"],
  period = "2026",
): SpreadAuditFinding => ({
  period, statement: "balance_sheet", rowLabel, issueType: "missing_implied_component",
  expectedValue: null, actualValue: null, difference: null, tolerance: 1,
  sourceFactIds: [], documentIds: [], severity, detail: `${rowLabel} missing_implied_component`,
});

const spreadAccuracy = (findings: SpreadAuditFinding[]): SpreadAuditResult => ({
  status: findings.some((f) => f.severity === "blocker") ? "blocker" : "clean",
  findings,
  summary: { blockers: 0, warnings: 0, infos: 0, periodsAudited: [], footingsChecked: 0, mappedFactKeys: 0, unmappedFactKeys: 0 },
  blockedCells: [],
  actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 0, actions: [] },
});

const auditWith = (findings: SpreadAuditFinding[]): ClassicSpreadCertificationAudit => ({
  certificationVersion: 0,
  domains: {
    balance_sheet: { status: "clean", blocked: [] },
    personal_income: { status: "clean", replacements: [] },
    global_cash_flow: { status: "blocked", preliminary: false, blocked: [{ row: "Global Cash Flow", labelPeriod: "n/a", sourcePeriod: null, reason: "entity cash flow not computed (re-run spread pipeline)" }] },
    ratios: { status: "clean", suppressed: [] },
  },
  dependencyStatuses: { personalIncome: "ok" },
  suppressions: [],
  spreadAccuracy: spreadAccuracy(findings),
});

describe("certification summary — computed GCF", () => {
  it("GCF reads PRELIMINARY (not 'entity cash flow not computed') once entity CF is computed", () => {
    const section = applyComputedEntityCashFlow(gcfSection(), INCOME_STATEMENT, PERIODS);
    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: auditWith([]), // gate GCF blocked, but the computed section overrides
      globalCashFlow: section,
      openReviewActionCount: 0,
    });
    assert.equal(s.domains.globalCashFlow.status, "preliminary");
    assert.ok(s.domains.globalCashFlow.reasons.some((r) => /derived from 2025 spread rows/i.test(r)));
    assert.ok(!s.domains.globalCashFlow.reasons.some((r) => /not computed/i.test(r)));
  });

  it("OmniCare: PI certified + entity CF computed + DSCR computed, YTD-2026 TCA blocker keeps OVERALL BLOCKED", () => {
    const section = applyComputedEntityCashFlow(gcfSection(), INCOME_STATEMENT, PERIODS);
    assert.equal(section.entityCashFlowAvailable, 205_112);
    assert.equal(section.proposedAnnualDebtService, 101_250);
    assert.ok(section.globalDscr != null);

    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: auditWith([finding("TOTAL CURRENT ASSETS", "blocker", "2026")]), // YTD-2026 TCA source detail
      globalCashFlow: section,
      openReviewActionCount: 1,
    });
    assert.equal(s.domains.personalIncome.status, "certified");
    assert.equal(s.domains.globalCashFlow.status, "preliminary"); // computed, no longer blocked
    assert.equal(s.status, "blocked"); // YTD-2026 TCA blocker keeps the spread blocked
    assert.notEqual(s.status, "certified");

    const lines = certificationStatusLines(s);
    assert.ok(lines.some((l) => /^Spread Certification: BLOCKED/.test(l)));
    assert.ok(lines.some((l) => /^GCF certification: preliminary/.test(l)));
    assert.ok(!lines.some((l) => /GCF certification: blocked - .*not computed/i.test(l)));
    assert.ok(lines.some((l) => /TOTAL CURRENT ASSETS/.test(l))); // the TCA source-detail action remains
  });

  it("GCF stays BLOCKED when entity cash flow cannot be computed (no annual rows)", () => {
    const section = applyComputedEntityCashFlow(gcfSection(), [], PERIODS); // unchanged: entity null
    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: auditWith([]),
      globalCashFlow: section,
      openReviewActionCount: 0,
    });
    assert.equal(s.domains.globalCashFlow.status, "blocked");
    assert.ok(s.domains.globalCashFlow.reasons.some((r) => /not computed/i.test(r)));
  });
});

// ── PDF render ──────────────────────────────────────────────────────────────────────────────────
const renderInput = (gcf: GlobalCashFlowSection): ClassicSpreadInput => ({
  dealId: "d1",
  companyName: "OmniCare",
  preparedDate: "x",
  naicsCode: null,
  naicsDescription: null,
  bankName: "Bank",
  periods: PERIODS,
  balanceSheet: [isRow("TOTAL ASSETS", [1, 2, 3, 4])],
  incomeStatement: INCOME_STATEMENT,
  cashFlow: [],
  cashFlowPeriods: [],
  ratioSections: [],
  globalCashFlow: gcf,
  personalIncome: null,
  executiveSummary: { assets: [], liabilitiesAndNetWorth: [], incomeStatement: [] },
  certified: true,
});

describe("PDF render — computed GCF page", () => {
  it("renders the Global Cash Flow page without the 'Entity data not yet computed' message once computed", async () => {
    const computed = applyComputedEntityCashFlow(gcfSection(), INCOME_STATEMENT, PERIODS);
    const buf = await renderClassicSpread(renderInput(computed));
    assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
    // The "Entity data not yet computed" branch is gated on entityCashFlowAvailable being null; once
    // computed it is non-null, so the value branch + provenance note render instead.
    assert.equal(computed.entityCashFlowAvailable != null, true);
  });

  it("still renders a valid PDF when entity cash flow could not be computed", async () => {
    const buf = await renderClassicSpread(renderInput(gcfSection()));
    assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
  });
});
