/**
 * SPEC-CLASSIC-SPREAD-FINAL-AUDIT-COPY-POLISH-1 — PDF copy/glyph polish.
 *
 * Proves the Classic Banker Spread PDF renders plain ASCII for the methodology block, the GCF coverage
 * band, and the certification lines — no raw Unicode the core PDF font garbles ("DSCR \"e 1.25x",
 * "EBITDA !' OBI !' NI") — without touching financial math, certification status, or source-line
 * behavior. The render assertions decode the actual PDF content streams (hex-encoded TJ glyph runs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { sanitizeForPdf } from "../pdfText";
import { renderClassicSpread } from "../classicSpreadRenderer";
import { applyComputedEntityCashFlow } from "../entityCashFlowFromSpread";
import { buildClassicSpreadCertificationSummary, certificationStatusLines } from "../certification/certificationSummary";
import { CLASSIC_PDF_RENDER_VERSION } from "../classicPdfRenderVersion";
import { METHODOLOGY_AXES } from "@/lib/methodology/methodologyAxes";
import type {
  ClassicSpreadInput,
  FinancialRow,
  GlobalCashFlowSection,
  StatementPeriod,
} from "../types";
import type { ClassicSpreadCertificationAudit } from "../certification/certifiedSpreadGateCore";
import type { SpreadAuditFinding, SpreadAuditResult } from "../audit/spreadAccuracyAudit";

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const NON_ASCII = /[^\x00-\x7F]/;

/** Decode the visible text from a PDFKit PDF: inflate streams, hex-decode the `<...>` TJ glyph runs. */
function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  let decoded = "";
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    const data = Buffer.from(m[1], "latin1");
    try { decoded += zlib.inflateSync(data).toString("latin1"); } catch { /* not a flate stream */ }
  }
  let text = "";
  const hexRe = /<([0-9a-fA-F]+)>/g;
  let h: RegExpExecArray | null;
  while ((h = hexRe.exec(decoded))) {
    const hex = h[1];
    for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return text;
}

const annual = (label: string, date: string): StatementPeriod => ({
  date, months: 12, auditMethod: "Tax Return", stmtType: "Annual", label,
});
const isRow = (label: string, values: (number | null)[]): FinancialRow => ({
  label, indent: 0, isBold: true, values, showPct: false,
});

const PERIODS: StatementPeriod[] = [
  annual("2023", "12/31/2023"),
  annual("2024", "12/31/2024"),
  annual("2025", "12/31/2025"),
];
const INCOME_STATEMENT: FinancialRow[] = [
  isRow("EBITDA", [180_000, 195_000, 1_007_974]),
  isRow("NET PROFIT", [90_000, 95_000, 101_000]),
];

// methodology entry built from the REAL registry label (carries the "EBITDA → OBI → NI" arrows).
const ncadsStandard = METHODOLOGY_AXES.ncads_source.variants.find((v) => v.id === "standard")!;
const baseSection = (): GlobalCashFlowSection => ({
  taxYear: null,
  entityCashFlowAvailable: null,
  entityCount: 1,
  sponsors: [{ entityId: "g1", displayName: "Guarantor 1", personalCashAvailable: 50_000 }],
  globalCashFlow: null,
  proposedAnnualDebtService: 101_250,
  globalDscr: null,
  coverageStatus: "UNKNOWN",
  methodology: [{
    axisId: "ncads_source",
    axisLabel: METHODOLOGY_AXES.ncads_source.label,
    chosenVariantId: "standard",
    chosenVariantLabel: ncadsStandard.label, // "Standard (EBITDA → OBI → NI)"
    rationale: ncadsStandard.rationale,
    isDefault: true,
  }],
});

const renderInput = (gcf: GlobalCashFlowSection): ClassicSpreadInput => ({
  dealId: "d1",
  companyName: "OmniCare",
  preparedDate: "x",
  naicsCode: null,
  naicsDescription: null,
  bankName: "Bank",
  periods: PERIODS,
  balanceSheet: [isRow("TOTAL ASSETS", [1, 2, 3])],
  incomeStatement: INCOME_STATEMENT,
  cashFlow: [],
  cashFlowPeriods: [],
  ratioSections: [],
  globalCashFlow: gcf,
  personalIncome: null,
  executiveSummary: { assets: [], liabilitiesAndNetWorth: [], incomeStatement: [] },
  certified: true,
});

// ── sanitizeForPdf glyph mappings ───────────────────────────────────────────────────────────────
describe("sanitizeForPdf — PDF-safe glyph mappings", () => {
  it("maps comparison / arrow / dash / quote / section glyphs to ASCII", () => {
    assert.equal(sanitizeForPdf("≥"), ">=");
    assert.equal(sanitizeForPdf("≤"), "<=");
    assert.equal(sanitizeForPdf("→"), "->");
    assert.equal(sanitizeForPdf("–"), "-");
    assert.equal(sanitizeForPdf("—"), "-");
    assert.equal(sanitizeForPdf("’"), "'");
    assert.equal(sanitizeForPdf("§179"), "Section 179");
  });

  it("renders the methodology label and the coverage band as ASCII", () => {
    assert.equal(sanitizeForPdf("Standard (EBITDA → OBI → NI)"), "Standard (EBITDA -> OBI -> NI)");
    assert.equal(sanitizeForPdf("ADEQUATE — DSCR ≥ 1.25x"), "ADEQUATE - DSCR >= 1.25x");
    assert.ok(!NON_ASCII.test(sanitizeForPdf(`${METHODOLOGY_AXES.ncads_source.label}: ${ncadsStandard.label}`)));
  });
});

// ── rendered PDF (decoded content streams) ──────────────────────────────────────────────────────
describe("PDF render — methodology + coverage band are ASCII-safe", () => {
  it("renders 'NCADS Source: Standard (EBITDA -> OBI -> NI)' and 'ADEQUATE - DSCR >= 1.25x'", async () => {
    const computed = applyComputedEntityCashFlow(baseSection(), INCOME_STATEMENT, PERIODS);
    const text = extractPdfText(await renderClassicSpread(renderInput(computed)));

    assert.ok(text.includes("NCADS Source: Standard (EBITDA -> OBI -> NI)"), "methodology line ASCII");
    assert.ok(text.includes("ADEQUATE - DSCR >= 1.25x"), "coverage band ASCII");
    // the garbled raw glyphs must NOT survive into the rendered text
    assert.ok(!text.includes("→") && !text.includes("≥") && !text.includes("—") && !text.includes("’"),
      "no raw Unicode arrows/comparison/dash/quote glyphs in the rendered PDF");
  });
});

// ── certification lines (the exact text drawCertificationStatus sanitizes + draws) ────────────────
const finding = (rowLabel: string, severity: SpreadAuditFinding["severity"], period = "2026"): SpreadAuditFinding => ({
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
const omniCareAudit = (): ClassicSpreadCertificationAudit => ({
  certificationVersion: 0,
  domains: {
    balance_sheet: { status: "clean", blocked: [] },
    personal_income: { status: "clean", replacements: [] },
    global_cash_flow: { status: "blocked", preliminary: false, blocked: [] },
    ratios: { status: "clean", suppressed: [] },
  },
  dependencyStatuses: { personalIncome: "ok" },
  suppressions: [],
  spreadAccuracy: spreadAccuracy([finding("TOTAL CURRENT ASSETS", "blocker", "2026")]),
});

describe("certification status lines stay present and ASCII-safe", () => {
  it("keeps PI certified / GCF preliminary / REQUEST_SOURCE_DETAIL, all ASCII after sanitization", () => {
    const section = applyComputedEntityCashFlow(baseSection(), INCOME_STATEMENT, PERIODS);
    const summary = buildClassicSpreadCertificationSummary({
      certified: true, audit: omniCareAudit(), globalCashFlow: section, openReviewActionCount: 1,
    });
    const lines = certificationStatusLines(summary);

    assert.ok(lines.some((l) => /^Personal income certification: certified/.test(l)));
    assert.ok(lines.some((l) => /^GCF certification: preliminary/.test(l)));
    assert.ok(lines.some((l) => /REQUEST_SOURCE_DETAIL/.test(l)));
    // every line, as the renderer draws it (sanitizeForPdf), is plain ASCII
    for (const l of lines) assert.ok(!NON_ASCII.test(sanitizeForPdf(l)), `ASCII: ${JSON.stringify(l)}`);
  });
});

// ── render version + cache rejection ──────────────────────────────────────────────────────────────
describe("render version", () => {
  it("CLASSIC_PDF_RENDER_VERSION is bumped to 20", () => {
    assert.equal(CLASSIC_PDF_RENDER_VERSION, 20);
  });
  it("rejects a cached prior-version (v16) blob", () => {
    const isRejected = (renderVersion: number | undefined) => (renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION;
    assert.equal(isRejected(16), true);
    assert.equal(isRejected(CLASSIC_PDF_RENDER_VERSION), false);
  });
});
