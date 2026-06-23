/**
 * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-GCF-CERTIFICATION-1 — personal income + GCF certification.
 *
 * Proves the cross-owner personal-income selection (strong PERSONAL_TAX_RETURN/DEAL over weak
 * PERSONAL_INCOME micro-stubs; legit zeros + real losses preserved), the honest per-domain gate
 * statuses, the GCF domain reading blocked when entity cash flow / DSCR is not computed, and the
 * summary roll-up + rendered status lines. OmniCare numbers are fixtures, not hardcoded paths.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { certifyPersonalIncome, type PersonalIncomeFact } from "../certifiedPersonalIncome";
import { computeCertificationDecisions, type GateFact } from "../certifiedSpreadGateCore";
import { buildClassicSpreadCertificationSummary, certificationStatusLines } from "../certificationSummary";
import type { ClassicSpreadCertificationAudit } from "../certifiedSpreadGateCore";
import type { GlobalCashFlowSection } from "../../types";

// ── personal-income fact fixtures ───────────────────────────────────────────────────────────────
const strong = (key: string, value: number, year = 2023): PersonalIncomeFact => ({
  id: `strong-${key}-${year}`, fact_key: key, fact_value_num: value, fact_period_end: `${year}-12-31`,
  owner_type: "DEAL", owner_entity_id: null, source_document_id: "doc-tax", source_canonical_type: "PERSONAL_TAX_RETURN",
  fact_type: "TAX_RETURN", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: false, resolution_status: null,
});
const weak = (key: string, value: number, year = 2023): PersonalIncomeFact => ({
  id: `weak-${key}-${year}`, fact_key: key, fact_value_num: value, fact_period_end: `${year}-12-31`,
  owner_type: "PERSONAL", owner_entity_id: null, source_document_id: "doc-pi", source_canonical_type: "PERSONAL_TAX_RETURN",
  fact_type: "PERSONAL_INCOME", confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic", is_superseded: false, resolution_status: null,
});

describe("certifyPersonalIncome cross-owner selection", () => {
  it("chooses the strong PERSONAL_TAX_RETURN/DEAL fact over the weak PERSONAL_INCOME micro-stub", () => {
    const r = certifyPersonalIncome([
      strong("WAGES_W2", 310_134), weak("WAGES_W2", 3),
      strong("ADJUSTED_GROSS_INCOME", 282_742), weak("ADJUSTED_GROSS_INCOME", 0),
      strong("TAXABLE_INCOME", 249_968), weak("TAXABLE_INCOME", 456),
    ]);
    const get = (sem: string) => r.certifications.find((c) => c.semantic === sem && c.year === 2023)!;
    assert.equal(get("WAGES_W2").value.value, 310_134);
    assert.equal(get("ADJUSTED_GROSS_INCOME").value.value, 282_742);
    assert.equal(get("TAXABLE_INCOME").value.value, 249_968);
    // the weak stub is recorded as a rejected competitor (not silently dropped)
    assert.ok(get("WAGES_W2").rejected.some((x) => x.value === 3));
  });

  it("preserves a legitimate zero (no contradicting material sibling)", () => {
    const r = certifyPersonalIncome([strong("TOTAL_TAX", 0, 2024)]);
    const c = r.certifications.find((x) => x.semantic === "TOTAL_TAX" && x.year === 2024)!;
    assert.equal(c.value.value, 0);
    assert.equal(c.value.status, "certified");
  });

  it("preserves a real loss (negative material value)", () => {
    const r = certifyPersonalIncome([strong("ADJUSTED_GROSS_INCOME", -42_000, 2024)]);
    const c = r.certifications.find((x) => x.semantic === "ADJUSTED_GROSS_INCOME" && x.year === 2024)!;
    assert.equal(c.value.value, -42_000);
    assert.equal(c.value.status, "certified");
  });
});

// ── gate per-domain statuses ──────────────────────────────────────────────────────────────────
const gateFact = (f: PersonalIncomeFact): GateFact => ({
  ...f,
  fact_type: f.fact_type ?? null,
  is_superseded: f.is_superseded ?? null,
  resolution_status: f.resolution_status ?? null,
});

describe("gate personal-income + GCF domain status", () => {
  it("personal income is CLEAN when strong facts back the required lines", () => {
    const { audit } = computeCertificationDecisions(
      [strong("WAGES_W2", 310_134), strong("ADJUSTED_GROSS_INCOME", 282_742), strong("TAXABLE_INCOME", 249_968), strong("TOTAL_TAX", 45_333)].map(gateFact),
      { periods: [], gcfTaxYear: null },
    );
    assert.equal(audit.domains.personal_income.status, "clean");
  });

  it("personal income is CAVEATED when only a weak source backs a line", () => {
    const { audit } = computeCertificationDecisions([weak("WAGES_W2", 90_000)].map(gateFact), { periods: [], gcfTaxYear: null });
    assert.equal(audit.domains.personal_income.status, "caveated");
  });

  it("GCF is BLOCKED when there is no entity cash flow to certify (no sources / tax year)", () => {
    const { audit } = computeCertificationDecisions([strong("WAGES_W2", 310_134)].map(gateFact), { periods: [], gcfTaxYear: null });
    assert.equal(audit.domains.global_cash_flow.status, "blocked");
    assert.ok(audit.domains.global_cash_flow.blocked.some((b) => /not computed/i.test(b.reason)));
  });
});

// ── summary roll-up (GCF evaluated against the rendered section) ────────────────────────────────
const auditWith = (
  pi: "clean" | "caveated" | "blocked",
  gcf: "clean" | "caveated" | "blocked",
): ClassicSpreadCertificationAudit => ({
  certificationVersion: 0,
  domains: {
    balance_sheet: { status: "clean", blocked: [] },
    personal_income: { status: pi, replacements: [] },
    global_cash_flow: { status: gcf, preliminary: gcf === "caveated", blocked: [] },
    ratios: { status: "clean", suppressed: [] },
  },
  dependencyStatuses: { personalIncome: pi === "blocked" ? "blocked" : "ok" },
  suppressions: [],
  spreadAccuracy: { status: "clean", findings: [], summary: { blockers: 0, warnings: 0, infos: 0, periodsAudited: [], footingsChecked: 0, mappedFactKeys: 0, unmappedFactKeys: 0 }, blockedCells: [], actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 0, actions: [] } },
});

const gcfSection = (over: Partial<GlobalCashFlowSection>): GlobalCashFlowSection => ({
  taxYear: 2023, entityCashFlowAvailable: 500_000, entityCount: 1, sponsors: [],
  globalCashFlow: 600_000, proposedAnnualDebtService: 200_000, globalDscr: 3.0, coverageStatus: "ADEQUATE", ...over,
});

describe("certification summary — personal income + GCF", () => {
  it("GCF blocked when entity cash flow is not computed (section has null entity/global CF)", () => {
    const s = buildClassicSpreadCertificationSummary({
      certified: true, audit: auditWith("clean", "clean"),
      globalCashFlow: gcfSection({ entityCashFlowAvailable: null, globalCashFlow: null, globalDscr: null }),
      openReviewActionCount: 0,
    });
    assert.equal(s.domains.globalCashFlow.status, "blocked");
    assert.ok(s.domains.globalCashFlow.reasons.some((r) => /entity cash flow not computed/i.test(r)));
    assert.equal(s.status, "blocked"); // a blocked domain blocks the spread
  });

  it("GCF blocked when the global DSCR is unavailable", () => {
    const s = buildClassicSpreadCertificationSummary({
      certified: true, audit: auditWith("clean", "clean"),
      globalCashFlow: gcfSection({ globalDscr: null }), openReviewActionCount: 0,
    });
    assert.equal(s.domains.globalCashFlow.status, "blocked");
    assert.ok(s.domains.globalCashFlow.reasons.some((r) => /global DSCR unavailable/i.test(r)));
  });

  it("personal income certified maps to certified; GCF certified when all inputs present + gate clean", () => {
    const s = buildClassicSpreadCertificationSummary({
      certified: true, audit: auditWith("clean", "clean"), globalCashFlow: gcfSection({}), openReviewActionCount: 0,
    });
    assert.equal(s.domains.personalIncome.status, "certified");
    assert.equal(s.domains.globalCashFlow.status, "certified");
    assert.equal(s.status, "certified");
  });

  it("OmniCare: personal income certified, GCF blocked (entity CF not computed), overall BLOCKED", () => {
    const s = buildClassicSpreadCertificationSummary({
      certified: true,
      audit: auditWith("clean", "clean"), // PI strong → clean; gate GCF clean but section overrides
      globalCashFlow: null, // entity cash flow not computed
      openReviewActionCount: 0,
    });
    assert.equal(s.domains.personalIncome.status, "certified");
    assert.equal(s.domains.globalCashFlow.status, "blocked");
    assert.equal(s.status, "blocked");
    assert.notEqual(s.status, "certified");
  });

  it("rendered status lines include explicit Personal Income and GCF certification lines", () => {
    const s = buildClassicSpreadCertificationSummary({
      certified: true, audit: auditWith("clean", "clean"), globalCashFlow: null, openReviewActionCount: 0,
    });
    const lines = certificationStatusLines(s);
    assert.ok(lines.some((l) => /^Personal income certification: certified/.test(l)));
    assert.ok(lines.some((l) => /^GCF certification: blocked - .*entity cash flow not computed/i.test(l)));
  });
});
