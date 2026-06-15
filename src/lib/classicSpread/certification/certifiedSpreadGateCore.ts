/**
 * SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1 (Phase 6) — PURE core of the gate.
 *
 * Runs the Phase 2-5 certification modules over a deal's facts and produces (a) a serializable
 * AUDIT for rendered_json and (b) render DECISIONS that suppress blocked values and replace weak
 * personal-income values with the certified ones.
 *
 *   - computeCertificationDecisions(facts, ctx)  — runs Phases 2-5, returns audit+decisions.
 *   - applyCertificationToInput(input, decisions) — mutates the assembled ClassicSpreadInput.
 *
 * No DB, no server-only — the IO wrapper (runClassicSpreadCertification) lives in
 * certifiedSpreadGate.ts. Does NOT import reconcileFinancialFacts directly and does NOT touch the
 * canonical VM. Reuses Phase 1 certifyFactSelection (the business-fact selector) for the BS.
 */

import { CLASSIC_PDF_RENDER_VERSION } from "@/lib/classicSpread/classicPdfRenderVersion";
import type { ClassicSpreadInput } from "@/lib/classicSpread/types";
import type { PersonalIncomeYear } from "@/lib/classicSpread/personalIncomeLoader";

import { certifyFactSelection, type CertifiableFact } from "./certifyFactSelection";
import { certifyBalanceSheet } from "./certifiedBalanceSheet";
import { certifyPersonalIncome, type PersonalIncomeFact } from "./certifiedPersonalIncome";
import { certifyGlobalCashFlow, type GcfSourceFact, type GcfDependencyStatus } from "./certifiedGlobalCashFlow";
import { certifyRatio, type RatioOperand } from "./certifiedRatios";
import type { CertificationStatus } from "./certifiedSpreadAudit";
import type { SpreadAuditResult } from "@/lib/classicSpread/audit/spreadAccuracyAudit";

/** A fact loaded for certification — superset of every domain module's input. */
export type GateFact = {
  id: string | null;
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string | null;
  owner_type: string;
  owner_entity_id: string | null;
  source_document_id: string | null;
  source_canonical_type: string | null;
  fact_type: string | null;
  confidence: number | null;
  extractor: string | null;
  is_superseded: boolean | null;
  resolution_status: string | null;
};

// Personal-income semantic → PersonalIncomeYear render field.
const PERSONAL_FIELD: Record<string, keyof PersonalIncomeYear> = {
  WAGES_W2: "wagesW2",
  ADJUSTED_GROSS_INCOME: "adjustedGrossIncome",
  TAXABLE_INCOME: "taxableIncome",
  TOTAL_TAX: "totalTax",
};

const GCF_SOURCE_KEYS = ["CASH_FLOW_AVAILABLE", "GCF_GLOBAL_CASH_FLOW", "GLOBAL_CASH_FLOW", "GCF_CASH_AVAILABLE"];

// ── decisions + audit shapes ────────────────────────────────────────────────

export type CertificationDecisions = {
  personalIncome: { year: number; field: keyof PersonalIncomeYear; value: number | null }[];
  balanceSheet: { periodIndex: number; rowLabels: string[] }[];
  gcf: { blankTaxYearLabel: boolean; blankFields: ("entityCashFlowAvailable" | "globalCashFlow" | "globalDscr")[] } | null;
  /** whole-row ratio blanks (mislabeled DSCR rows — interest-expense denominator) */
  ratios: { sectionTitle: string; rowLabel: string }[];
  /** per-period ratio CELL blanks (leverage/growth ratios that derive from a blocked liability) */
  ratioCells: { sectionTitle: string; rowLabel: string; periodIndex: number }[];
};

// Leverage / growth ratio rows the classic loader computes from getLiabilities(); when a period's
// Total Liabilities is blocked these cells would otherwise render a false value (e.g. 0.00).
const LIABILITY_DERIVED_RATIOS: { sectionTitle: string; rowLabel: string; isGrowth?: boolean }[] = [
  { sectionTitle: "LEVERAGE", rowLabel: "Debt / Worth" },
  { sectionTitle: "LEVERAGE", rowLabel: "Debt / Tangible Net Worth" },
  { sectionTitle: "LEVERAGE", rowLabel: "Total Liabilities / Total Assets" },
  { sectionTitle: "GROWTH", rowLabel: "Total Liabilities Growth %", isGrowth: true },
];

export type ClassicSpreadCertificationAudit = {
  certificationVersion: number;
  domains: {
    balance_sheet: { status: CertificationStatus; blocked: { period: string; row: string; reason: string | null }[] };
    personal_income: {
      status: CertificationStatus;
      replacements: { year: number; field: string; value: number | null; status: string; reason: string }[];
    };
    global_cash_flow: { status: CertificationStatus; preliminary: boolean; blocked: { row: string; labelPeriod: string; sourcePeriod: string | null; reason: string }[] };
    ratios: { status: CertificationStatus; suppressed: { row: string; reason: string }[] };
  };
  dependencyStatuses: { personalIncome: GcfDependencyStatus };
  suppressions: { page: string; row: string; period: string | null; action: "blank" | "replace"; reason: string }[];
  /**
   * SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1: the line-accuracy / completion audit
   * (statement footing + missing-line detection) run AFTER suppression. Attached by the loader,
   * persisted into rendered_json, surfaced on the PDF, and consumed by the narrative guardrail.
   */
  spreadAccuracy?: SpreadAuditResult | null;
};

export type CertificationGateResult = {
  audit: ClassicSpreadCertificationAudit;
  decisions: CertificationDecisions;
};

// ── mappers ─────────────────────────────────────────────────────────────────

function toCertifiable(f: GateFact): CertifiableFact {
  return {
    id: f.id,
    fact_key: f.fact_key,
    fact_period_end: f.fact_period_end,
    owner_type: f.owner_type,
    owner_entity_id: f.owner_entity_id,
    source_document_id: f.source_document_id,
    source_canonical_type: f.source_canonical_type,
    confidence: f.confidence,
    extractor: f.extractor,
    fact_value_num: f.fact_value_num,
    is_superseded: f.is_superseded,
    resolution_status: f.resolution_status,
  };
}
function toPersonal(f: GateFact): PersonalIncomeFact {
  return { ...toCertifiable(f), fact_type: f.fact_type };
}
function toGcfSource(f: GateFact): GcfSourceFact {
  return {
    id: f.id,
    factKey: f.fact_key,
    value: f.fact_value_num,
    sourcePeriod: f.fact_period_end,
    ownerType: f.owner_type,
    ownerEntityId: f.owner_entity_id,
    documentId: f.source_document_id,
    canonicalType: f.source_canonical_type,
    factType: f.fact_type,
    confidence: f.confidence,
    extractor: f.extractor,
    is_superseded: f.is_superseded,
    resolution_status: f.resolution_status,
  };
}

// ── pure core ───────────────────────────────────────────────────────────────

/**
 * Run Phases 2-5 over the deal's facts and produce the audit + render decisions.
 * `ctx.periods` are the ISO period-ends of the rendered business columns (for column mapping);
 * `ctx.gcfTaxYear` is the tax-year label the GCF page would otherwise present.
 */
export function computeCertificationDecisions(
  facts: GateFact[],
  ctx: { periods: string[]; gcfTaxYear: number | null },
): CertificationGateResult {
  const suppressions: ClassicSpreadCertificationAudit["suppressions"] = [];

  // ── Phase 2: balance sheet ────────────────────────────────────────────────
  const selection = certifyFactSelection(facts.map(toCertifiable));
  const bsDecisions: CertificationDecisions["balanceSheet"] = [];
  const bsBlocked: { period: string; row: string; reason: string | null }[] = [];
  ctx.periods.forEach((period, periodIndex) => {
    const bs = certifyBalanceSheet(selection, period, { ownerType: "DEAL" });
    if (bs.totalLiabilities.status === "blocked") {
      bsDecisions.push({ periodIndex, rowLabels: ["TOTAL LIABILITIES", "TOTAL NON-CURRENT LIABILITIES"] });
      bsBlocked.push({ period, row: "TOTAL LIABILITIES", reason: bs.totalLiabilities.failureReason });
      suppressions.push({ page: "balance_sheet", row: "TOTAL LIABILITIES", period, action: "blank", reason: bs.totalLiabilities.failureReason ?? "blocked" });
    }
  });

  // ── Phase 3: personal income ──────────────────────────────────────────────
  const pi = certifyPersonalIncome(facts.map(toPersonal));
  const piReplacements: CertificationDecisions["personalIncome"] = [];
  const piAudit: ClassicSpreadCertificationAudit["domains"]["personal_income"]["replacements"] = [];
  for (const c of pi.certifications) {
    const field = PERSONAL_FIELD[c.semantic];
    if (!field) continue;
    const value = c.value.status === "certified" ? c.value.value : null;
    piReplacements.push({ year: c.year, field, value });
    piAudit.push({ year: c.year, field, value, status: c.value.status, reason: c.reason });
    if (c.rejected.length > 0 || c.value.status !== "certified") {
      suppressions.push({ page: "personal_income", row: `${c.semantic} ${c.year}`, period: `${c.year}-12-31`, action: c.value.status === "certified" ? "replace" : "blank", reason: c.reason });
    }
  }
  const piBlocked = pi.certifications.some((c) => c.value.status === "blocked");
  const piDependency: GcfDependencyStatus = piBlocked ? "blocked" : "ok";

  // ── Phase 4: global cash flow ─────────────────────────────────────────────
  const gcfSources = facts.filter((f) => GCF_SOURCE_KEYS.includes(f.fact_key));
  let gcfDecision: CertificationDecisions["gcf"] = null;
  const gcfBlocked: ClassicSpreadCertificationAudit["domains"]["global_cash_flow"]["blocked"] = [];
  let gcfPreliminary = false;
  if (ctx.gcfTaxYear !== null && gcfSources.length > 0) {
    const gcf = certifyGlobalCashFlow(
      [{ row: "Global Cash Flow", labelPeriod: String(ctx.gcfTaxYear), labelKind: "tax_year", dependsOnPersonalIncome: true, sources: gcfSources.map(toGcfSource) }],
      { personalIncomeDependency: piDependency },
    );
    const cert = gcf.certifications[0];
    gcfPreliminary = cert.preliminary;
    // A blocked OR merely-preliminary GCF cannot present a clean tax-year-labeled number.
    if (cert.value.status === "blocked" || cert.preliminary) {
      gcfDecision = { blankTaxYearLabel: true, blankFields: ["entityCashFlowAvailable", "globalCashFlow", "globalDscr"] };
      gcfBlocked.push({ row: cert.row, labelPeriod: cert.labelPeriod, sourcePeriod: cert.sourcePeriod, reason: cert.reason });
      suppressions.push({ page: "global_cash_flow", row: cert.row, period: cert.sourcePeriod, action: "blank", reason: cert.reason });
    }
  }

  // ── Phase 5: ratios ───────────────────────────────────────────────────────
  // The classic loader computes "DSCR (Traditional)" and "UCA Cash Flow DSCR" with INTEREST
  // EXPENSE as the denominator — a DSCR can never certify from interest expense, so those rows
  // are suppressed. The correctly-labeled "Interest Coverage" row is kept.
  const ratioSuppress: CertificationDecisions["ratios"] = [];
  const ratioAudit: ClassicSpreadCertificationAudit["domains"]["ratios"]["suppressed"] = [];
  const dscrProbe = certifyRatio({
    ratioType: "DSCR_TRADITIONAL",
    numerator: { id: null, factKey: "NET_INCOME", value: 1, period: null, documentId: null, canonicalType: null, confidence: null, extractor: null } as RatioOperand,
    denominator: { id: null, factKey: "INTEREST_EXPENSE", value: 1, period: null, documentId: null, canonicalType: null, confidence: null, extractor: null, kind: "interest_expense" },
  });
  if (dscrProbe.value.status === "blocked") {
    for (const rowLabel of ["DSCR (Traditional)", "UCA Cash Flow DSCR"]) {
      ratioSuppress.push({ sectionTitle: "COVERAGE", rowLabel });
      ratioAudit.push({ row: rowLabel, reason: dscrProbe.reason });
      suppressions.push({ page: "ratios", row: rowLabel, period: null, action: "blank", reason: dscrProbe.reason });
    }
  }

  // A blocked Total Liabilities must not feed leverage/growth ratios — blank those CELLS at the
  // affected period column (and, for a YoY growth ratio, the next column whose base is blocked).
  const ratioCells: CertificationDecisions["ratioCells"] = [];
  for (const d of bsDecisions) {
    const period = ctx.periods[d.periodIndex];
    for (const r of LIABILITY_DERIVED_RATIOS) {
      const cols = r.isGrowth ? [d.periodIndex, d.periodIndex + 1] : [d.periodIndex];
      for (const periodIndex of cols) {
        ratioCells.push({ sectionTitle: r.sectionTitle, rowLabel: r.rowLabel, periodIndex });
      }
      ratioAudit.push({ row: r.rowLabel, reason: `derives from Total Liabilities blocked at ${period ?? d.periodIndex}` });
      suppressions.push({ page: "ratios", row: r.rowLabel, period: period ?? null, action: "blank", reason: "liability-derived ratio at a blocked-liability period" });
    }
  }

  const statusOf = (blocked: boolean, caveated: boolean): CertificationStatus =>
    blocked ? "blocked" : caveated ? "caveated" : "clean";

  const audit: ClassicSpreadCertificationAudit = {
    certificationVersion: CLASSIC_PDF_RENDER_VERSION,
    domains: {
      balance_sheet: { status: statusOf(bsBlocked.length > 0, false), blocked: bsBlocked },
      personal_income: { status: statusOf(piBlocked, piReplacements.some((r) => r.value !== null)), replacements: piAudit },
      global_cash_flow: { status: statusOf(gcfBlocked.length > 0 && !gcfPreliminary, gcfPreliminary), preliminary: gcfPreliminary, blocked: gcfBlocked },
      ratios: { status: statusOf(false, ratioSuppress.length > 0), suppressed: ratioAudit },
    },
    dependencyStatuses: { personalIncome: piDependency },
    suppressions,
  };

  return { audit, decisions: { personalIncome: piReplacements, balanceSheet: bsDecisions, gcf: gcfDecision, ratios: ratioSuppress, ratioCells } };
}

/** Apply render decisions to an assembled ClassicSpreadInput (mutates in place). */
export function applyCertificationToInput(input: ClassicSpreadInput, decisions: CertificationDecisions): void {
  // Personal income — replace weak values with the certified ones (or blank when not certified).
  if (input.personalIncome) {
    for (const r of decisions.personalIncome) {
      const yr = input.personalIncome.years.find((y) => y.year === r.year);
      // r.field is always a numeric PersonalIncomeYear field (see PERSONAL_FIELD).
      if (yr) (yr as unknown as Record<string, number | null>)[r.field] = r.value;
    }
  }
  // Balance sheet — blank blocked total rows at the affected period column.
  for (const d of decisions.balanceSheet) {
    for (const label of d.rowLabels) {
      const row = input.balanceSheet.find((rr) => rr.label === label);
      if (row && d.periodIndex >= 0 && d.periodIndex < row.values.length) row.values[d.periodIndex] = null;
    }
  }
  // Global cash flow — strip a false tax-year label and blank blocked numbers.
  if (decisions.gcf && input.globalCashFlow) {
    if (decisions.gcf.blankTaxYearLabel) input.globalCashFlow.taxYear = null;
    for (const f of decisions.gcf.blankFields) input.globalCashFlow[f] = null;
  }
  // Ratios — blank suppressed (mislabeled) DSCR rows across all periods.
  for (const s of decisions.ratios) {
    const section = input.ratioSections.find((sec) => sec.title === s.sectionTitle);
    const row = section?.rows.find((rr) => rr.label === s.rowLabel);
    if (row) row.values = row.values.map(() => null);
  }
  // Ratios — blank individual leverage/growth CELLS at blocked-liability period columns.
  for (const c of decisions.ratioCells) {
    const section = input.ratioSections.find((sec) => sec.title === c.sectionTitle);
    const row = section?.rows.find((rr) => rr.label === c.rowLabel);
    if (row && c.periodIndex >= 0 && c.periodIndex < row.values.length) row.values[c.periodIndex] = null;
  }
}
