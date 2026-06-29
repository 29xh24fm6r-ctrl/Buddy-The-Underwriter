/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 1 tests.
 *
 * Fixtures are the REAL OmniCare conflicts (live audit 2026-06-27), so green here
 * means the selection layer resolves the actual messiness, not a clean toy.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  selectCertifiedValue,
  buildCertifiedSnapshots,
  scopeOf,
  sourceCanonicalTypeToTrust,
  type CertifiedFactRow,
} from "@/lib/finengine/shadow/dealInputAdapter";

const DEAL = "80fe6f7a-5c68-4f02-8bcf-933f246a9fc5";

/** Real OmniCare rows (subset) reproducing collision (a), constant-bug (b), misalignment (c). */
const ROWS: CertifiedFactRow[] = [
  // TAXABLE_INCOME — business loss collides with guarantor personal income on the same key+period.
  row("TAXABLE_INCOME", "2023-12-31", -457567, "BUSINESS_TAX_RETURN", "DEAL", 0.5, "taxReturnExtractor:v2:deterministic"),
  row("TAXABLE_INCOME", "2023-12-31", 249968, "PERSONAL_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("TAXABLE_INCOME", "2023-12-31", 456, "PERSONAL_TAX_RETURN", "PERSONAL", 0.55, "personalIncomeExtractor:v2:deterministic"),
  row("TAXABLE_INCOME", "2022-12-31", 214586, "PERSONAL_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("TAXABLE_INCOME", "2022-12-31", 456, "PERSONAL_TAX_RETURN", "PERSONAL", 0.55, "personalIncomeExtractor:v2:deterministic"),
  row("TAXABLE_INCOME", "2024-12-31", 200925, "BUSINESS_TAX_RETURN", "DEAL", 0.5, "taxReturnExtractor:v2:deterministic"),

  // M1_TAXABLE_INCOME — gemini carries the real value; the deterministic extractor is stuck at 27.
  row("M1_TAXABLE_INCOME", "2022-12-31", 0, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("M1_TAXABLE_INCOME", "2022-12-31", 27, "BUSINESS_TAX_RETURN", "DEAL", 0.5, "taxReturnExtractor:v2:deterministic"),
  row("M1_TAXABLE_INCOME", "2023-12-31", -457567, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("M1_TAXABLE_INCOME", "2023-12-31", 27, "BUSINESS_TAX_RETURN", "DEAL", 0.5, "taxReturnExtractor:v2:deterministic"),
  row("M1_TAXABLE_INCOME", "2024-12-31", 200925, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("M1_TAXABLE_INCOME", "2024-12-31", 27, "BUSINESS_TAX_RETURN", "DEAL", 0.5, "taxReturnExtractor:v2:deterministic"),

  // DEPRECIATION — clean, per-year business values (the golden-set numbers).
  row("DEPRECIATION", "2022-12-31", 151225, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("DEPRECIATION", "2023-12-31", 61656, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),
  row("DEPRECIATION", "2024-12-31", 210207, "BUSINESS_TAX_RETURN", "DEAL", 0.8, "gemini_primary_v1"),

  // INTEREST_EXPENSE — only on 2025/2026 income statements, never the tax years.
  row("INTEREST_EXPENSE", "2025-12-31", 394774.1, "INCOME_STATEMENT", "DEAL", 0.8, "gemini_primary_v1"),
  row("INTEREST_EXPENSE", "2026-03-31", 94336.47, "INCOME_STATEMENT", "DEAL", 0.8, "gemini_primary_v1"),
];

function row(
  fact_key: string, fact_period_end: string, fact_value_num: number,
  source_canonical_type: string, owner_type: string, confidence: number, extractor: string,
): CertifiedFactRow {
  return { fact_key, fact_period_end, fact_value_num, source_canonical_type, owner_type, confidence, extractor, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}

const forKey = (k: string) => ROWS.filter((r) => r.fact_key === k);

describe("Phase 1 — entity partition (fix for §0a collision)", () => {
  it("BUSINESS TAXABLE_INCOME 2023 selects the business −457,567, never the personal 249,968", () => {
    const cv = selectCertifiedValue("TAXABLE_INCOME", "BUSINESS", "2023-12-31", forKey("TAXABLE_INCOME"));
    assert.equal(cv.value, -457567);
    assert.equal(cv.selectedFrom?.sourceCanonicalType, "BUSINESS_TAX_RETURN");
    assert.ok(cv.rejected.some((r) => r.value === 249968 && r.reason === "wrong_entity"), "personal income recorded as wrong_entity");
    assert.notEqual(cv.value, 249968);
  });

  it("the SAME key cleanly resolves PERSONAL scope to the guarantor's 249,968", () => {
    const cv = selectCertifiedValue("TAXABLE_INCOME", "PERSONAL", "2023-12-31", forKey("TAXABLE_INCOME"));
    assert.equal(cv.value, 249968);
    assert.ok(cv.rejected.some((r) => r.value === 456 && r.reason === "constant_bug"), "the 456 personal noise rejected as constant_bug");
  });

  it("entity partition wins even though the correct value has LOWER confidence", () => {
    // business −457,567 @0.5 must beat personal 249,968 @0.8 — partition precedes ranking.
    const cv = selectCertifiedValue("TAXABLE_INCOME", "BUSINESS", "2023-12-31", forKey("TAXABLE_INCOME"));
    assert.equal(cv.selectedFrom?.confidence, 0.5);
    assert.equal(cv.value, -457567);
  });
});

describe("Phase 1 — extractor resolution + constant-bug reject (fix for §0b)", () => {
  it("M1_TAXABLE_INCOME 2023 selects the gemini value and rejects the constant 27", () => {
    const cv = selectCertifiedValue("M1_TAXABLE_INCOME", "BUSINESS", "2023-12-31", forKey("M1_TAXABLE_INCOME"));
    assert.equal(cv.value, -457567);
    assert.equal(cv.selectedFrom?.extractor, "gemini_primary_v1");
    assert.ok(cv.rejected.some((r) => r.value === 27 && r.reason === "constant_bug"));
    assert.equal(cv.resolution, "unique"); // only gemini survives the reject
  });

  it("the constant 27 is rejected across every tax year, never selected", () => {
    for (const period of ["2022-12-31", "2023-12-31", "2024-12-31"]) {
      const cv = selectCertifiedValue("M1_TAXABLE_INCOME", "BUSINESS", period, forKey("M1_TAXABLE_INCOME"));
      assert.notEqual(cv.value, 27, `27 must not be selected on ${period}`);
    }
  });
});

describe("Phase 1 — period alignment (fix for §0c; NG3 no cross-period borrow)", () => {
  it("INTEREST_EXPENSE is unresolved on a tax year — the 2025/2026 values are NOT borrowed", () => {
    const cv = selectCertifiedValue("INTEREST_EXPENSE", "BUSINESS", "2023-12-31", forKey("INTEREST_EXPENSE"));
    assert.equal(cv.value, null);
    assert.equal(cv.resolution, "unresolved");
    assert.notEqual(cv.value, 394774.1);
  });
});

describe("Phase 1 — provenance + snapshots", () => {
  it("every selected value carries full selection provenance", () => {
    const cv = selectCertifiedValue("DEPRECIATION", "BUSINESS", "2024-12-31", forKey("DEPRECIATION"));
    assert.equal(cv.value, 210207);
    assert.ok(cv.selectedFrom);
    assert.equal(cv.selectedFrom!.extractor, "gemini_primary_v1");
    assert.equal(cv.selectedFrom!.confidence, 0.8);
    assert.equal(cv.selectedFrom!.sourceCanonicalType, "BUSINESS_TAX_RETURN");
  });

  it("scopeOf classifies by source first, then owner_type", () => {
    assert.equal(scopeOf(ROWS[0]), "BUSINESS"); // BUSINESS_TAX_RETURN
    assert.equal(scopeOf(ROWS[1]), "PERSONAL"); // PERSONAL_TAX_RETURN
  });

  it("business and personal snapshots do not bleed; missing interest is flagged, not borrowed", () => {
    const snaps = buildCertifiedSnapshots(DEAL, ROWS);
    const biz2023 = snaps.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2023-12-31");
    const per2023 = snaps.find((s) => s.entityScope === "PERSONAL" && s.fiscalPeriodEnd === "2023-12-31");
    assert.ok(biz2023 && per2023);
    assert.equal(biz2023!.facts["TAXABLE_INCOME"], -457567);
    assert.equal(biz2023!.facts["M1_TAXABLE_INCOME"], -457567);
    assert.equal(biz2023!.facts["DEPRECIATION"], 61656);
    assert.equal(per2023!.facts["TAXABLE_INCOME"], 249968);
    // interest absent on the tax year — present as a warning, never as a borrowed value
    assert.equal(biz2023!.facts["INTEREST_EXPENSE"], undefined);
    assert.ok(biz2023!.warnings.some((w) => w.includes("INTEREST_EXPENSE") && w.includes("NG3")));
  });

  it("a BUSINESS scope produces the 2025/2026 interest periods as their own snapshots", () => {
    const snaps = buildCertifiedSnapshots(DEAL, ROWS);
    const biz2025 = snaps.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2025-12-31");
    assert.ok(biz2025, "2025 business snapshot exists from the income-statement interest row");
    assert.equal(biz2025!.facts["INTEREST_EXPENSE"], 394774.1);
  });
});

// ===========================================================================
// SPEC-FINENGINE-KNOWLEDGE-WIRE-1 — Workstream A: document-trust ranking.
// Trust precedes confidence in the survivor ranking, so the higher-authority
// document wins a same-period conflict even at lower extractor confidence.
// ===========================================================================
describe("Knowledge-wire A — document-trust ranking", () => {
  const PERIOD = "2024-12-31";
  // A higher-trust audited statement (trust 100) at LOW confidence vs a
  // business tax return (trust 70) at HIGH confidence, same key/scope/period.
  const REVENUE_CONFLICT: CertifiedFactRow[] = [
    row("GROSS_RECEIPTS", PERIOD, 5_000_000, "AUDITED_FINANCIALS", "borrower", 0.6, "auditor_v1"),
    row("GROSS_RECEIPTS", PERIOD, 4_200_000, "BUSINESS_TAX_RETURN", "DEAL", 0.9, "gemini_primary_v1"),
  ];

  it("T-A1: higher-trust/lower-confidence beats lower-trust/higher-confidence", () => {
    const cv = selectCertifiedValue("GROSS_RECEIPTS", "BUSINESS", PERIOD, REVENUE_CONFLICT);
    assert.equal(cv.value, 5_000_000); // the audited number, not the higher-confidence tax return
    assert.equal(cv.selectedFrom?.sourceCanonicalType, "AUDITED_FINANCIALS");
    assert.equal(cv.selectedFrom?.confidence, 0.6); // won despite lower confidence
  });

  it("T-A2: equal trust falls through to confidence → recency → |value| (unchanged behavior)", () => {
    // Two BUSINESS_TAX_RETURN rows ⇒ identical trust ⇒ higher confidence wins.
    const sameTrust: CertifiedFactRow[] = [
      row("GROSS_RECEIPTS", PERIOD, 4_200_000, "BUSINESS_TAX_RETURN", "DEAL", 0.9, "gemini_primary_v1"),
      row("GROSS_RECEIPTS", PERIOD, 4_190_000, "BUSINESS_TAX_RETURN", "DEAL", 0.5, "taxReturnExtractor:v2:deterministic"),
    ];
    const cv = selectCertifiedValue("GROSS_RECEIPTS", "BUSINESS", PERIOD, sameTrust);
    assert.equal(cv.value, 4_200_000);
    assert.equal(cv.selectedFrom?.confidence, 0.9);
  });

  it("T-A3: SelectionProvenance.trustLevel is populated on the winner", () => {
    const cv = selectCertifiedValue("GROSS_RECEIPTS", "BUSINESS", PERIOD, REVENUE_CONFLICT);
    assert.equal(cv.selectedFrom?.trustLevel, 100); // AUDITED_FINANCIALS
    const taxOnly = selectCertifiedValue("DEPRECIATION", "BUSINESS", "2024-12-31", forKey("DEPRECIATION"));
    assert.equal(taxOnly.selectedFrom?.trustLevel, 70); // BUSINESS_TAX_RETURN
  });

  it("sourceCanonicalTypeToTrust: known types map to the trust hierarchy; unknown/absent floors at 40 (R2)", () => {
    assert.equal(sourceCanonicalTypeToTrust("AUDITED_FINANCIALS"), 100);
    assert.equal(sourceCanonicalTypeToTrust("BUSINESS_TAX_RETURN"), 70);
    assert.equal(sourceCanonicalTypeToTrust("PERSONAL_TAX_RETURN"), 65);
    assert.equal(sourceCanonicalTypeToTrust("BANK_STATEMENT"), 30);
    assert.equal(sourceCanonicalTypeToTrust("SOMETHING_UNMAPPED"), 40);
    assert.equal(sourceCanonicalTypeToTrust(null), 40);
    // Floor must never outrank a tax return (R2).
    assert.ok(sourceCanonicalTypeToTrust(null) < sourceCanonicalTypeToTrust("PERSONAL_TAX_RETURN"));
  });
});
