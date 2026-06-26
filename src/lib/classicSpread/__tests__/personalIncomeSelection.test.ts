/**
 * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 3) — loader integration.
 *
 * Proves the personalIncomeLoader pure core (buildCertifiedPersonalIncomeYears) routes selection
 * through the certified cross-owner selector: strong PERSONAL_TAX_RETURN / DEAL values beat weak
 * deterministic OCR micro-facts, superseded / rejected / system_invalidated facts are filtered,
 * legacy PERSONAL_INCOME-only decks pass through unchanged, and the audit explains the source.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildCertifiedPersonalIncomeYears } from "../personalIncomeSelection";
import type { PersonalIncomeFact } from "../certification/certifiedPersonalIncome";

const strong = (key: string, value: number, year = 2023, over: Partial<PersonalIncomeFact> = {}): PersonalIncomeFact => ({
  id: `strong-${key}-${year}`,
  fact_key: key,
  fact_value_num: value,
  fact_period_end: `${year}-12-31`,
  owner_type: "DEAL",
  owner_entity_id: null,
  source_document_id: "doc-tax",
  source_canonical_type: "PERSONAL_TAX_RETURN",
  fact_type: "TAX_RETURN",
  confidence: 0.8,
  extractor: "gemini_primary_v1",
  is_superseded: false,
  resolution_status: null,
  ...over,
});

const weak = (key: string, value: number, year = 2023, over: Partial<PersonalIncomeFact> = {}): PersonalIncomeFact => ({
  id: `weak-${key}-${year}`,
  fact_key: key,
  fact_value_num: value,
  fact_period_end: `${year}-12-31`,
  owner_type: "PERSONAL",
  owner_entity_id: null,
  source_document_id: "doc-pi",
  source_canonical_type: "PERSONAL_TAX_RETURN",
  fact_type: "PERSONAL_INCOME",
  confidence: 0.55,
  extractor: "personalIncomeExtractor:v2:deterministic",
  is_superseded: false,
  resolution_status: null,
  ...over,
});

const y2023 = (r: ReturnType<typeof buildCertifiedPersonalIncomeYears>) =>
  r.years.find((y) => y.year === 2023)!;

// ── 5. Known failure case: weak micro-facts must NOT outrank strong values ───────────────────

describe("Phase 3: weak OCR micro-facts never outrank strong tax-return values", () => {
  it("W-2=3/AGI=0/TAXABLE=456 lose to W-2=310134/AGI=282742/TAXABLE=249968", () => {
    const r = buildCertifiedPersonalIncomeYears([
      strong("WAGES_W2", 310_134), weak("WAGES_W2", 3),
      strong("ADJUSTED_GROSS_INCOME", 282_742), weak("ADJUSTED_GROSS_INCOME", 0),
      strong("TAXABLE_INCOME", 249_968), weak("TAXABLE_INCOME", 456),
    ]);
    const y = y2023(r);
    assert.equal(y.wagesW2, 310_134);
    assert.equal(y.adjustedGrossIncome, 282_742);
    assert.equal(y.taxableIncome, 249_968);

    // audit explains the selected source family and records the dropped weak competitors.
    assert.equal(r.audit.hasStrongFamily, true);
    assert.equal(r.audit.legacyOnly, false);
    const w2 = r.audit.selectedSources.find((s) => s.key === "WAGES_W2")!;
    assert.equal(w2.sourceFamily, "PERSONAL_TAX_RETURN");
    assert.equal(w2.ownerType, "DEAL");
    assert.ok(r.audit.rejected.some((x) => x.key === "WAGES_W2" && x.value === 3));
    assert.ok(r.audit.rejected.some((x) => x.key === "TAXABLE_INCOME" && x.value === 456));
  });

  it("does not require the weak fact to be superseded — selection alone demotes it", () => {
    // Both active; the strong simply wins on source quality. (Regression: legacy loader kept
    // the weak value because the strong one was never loaded for comparison.)
    const r = buildCertifiedPersonalIncomeYears([weak("WAGES_W2", 3), strong("WAGES_W2", 310_134)]);
    assert.equal(y2023(r).wagesW2, 310_134);
  });
});

// ── 6. superseded / rejected / low-quality filtering ─────────────────────────────────────────

describe("Phase 3: lifecycle + quality filtering", () => {
  it("a superseded fact is never selected (even if larger / higher confidence)", () => {
    const r = buildCertifiedPersonalIncomeYears([
      strong("WAGES_W2", 310_134),
      strong("WAGES_W2", 999_999, 2023, { id: "superseded", is_superseded: true }),
    ]);
    assert.equal(y2023(r).wagesW2, 310_134);
    // the superseded fact is filtered BEFORE selection, so it is not even a recorded competitor.
    assert.ok(!r.audit.rejected.some((x) => x.value === 999_999));
  });

  it("a resolution_status=rejected fact is never selected", () => {
    const r = buildCertifiedPersonalIncomeYears([
      strong("ADJUSTED_GROSS_INCOME", 282_742),
      strong("ADJUSTED_GROSS_INCOME", 777_777, 2023, { id: "rej", resolution_status: "rejected" }),
    ]);
    assert.equal(y2023(r).adjustedGrossIncome, 282_742);
  });

  it("a system_invalidated fact is never selected", () => {
    const r = buildCertifiedPersonalIncomeYears([
      strong("TAXABLE_INCOME", 249_968),
      strong("TAXABLE_INCOME", 888_888, 2023, { id: "inv", resolution_status: "system_invalidated" }),
    ]);
    assert.equal(y2023(r).taxableIncome, 249_968);
  });

  it("a null-valued fact contributes nothing", () => {
    const r = buildCertifiedPersonalIncomeYears([
      strong("WAGES_W2", 120_000),
      strong("WAGES_W2", null as unknown as number, 2023, { id: "nullval" }),
    ]);
    assert.equal(y2023(r).wagesW2, 120_000);
  });

  it("a superseded material fact is excluded; the micro-stub is dropped against the active material", () => {
    // superseded big value (310134) is filtered out; the active material 305000 still anchors
    // stub detection so the OCR stub 3 is dropped and never rendered.
    const r = buildCertifiedPersonalIncomeYears([
      strong("WAGES_W2", 310_134, 2023, { id: "sup", is_superseded: true }),
      weak("WAGES_W2", 3),
      strong("WAGES_W2", 305_000),
    ]);
    assert.equal(y2023(r).wagesW2, 305_000);
    assert.ok(r.audit.rejected.some((x) => x.key === "WAGES_W2" && x.value === 3));
    assert.ok(!r.audit.rejected.some((x) => x.value === 310_134), "superseded fact not a competitor");
  });
});

// ── 4. backwards compatibility: legacy PERSONAL_INCOME-only decks ─────────────────────────────

describe("Phase 3: backwards compatibility with legacy PERSONAL_INCOME-only facts", () => {
  it("passes through legacy values unchanged and flags legacyOnly", () => {
    const r = buildCertifiedPersonalIncomeYears([
      weak("WAGES_W2", 90_000),
      weak("ADJUSTED_GROSS_INCOME", 85_000),
      weak("TAXABLE_INCOME", 70_000),
    ]);
    const y = y2023(r);
    assert.equal(y.wagesW2, 90_000);
    assert.equal(y.adjustedGrossIncome, 85_000);
    assert.equal(y.taxableIncome, 70_000);
    assert.equal(r.audit.legacyOnly, true);
    assert.equal(r.audit.hasStrongFamily, false);
  });

  it("prefers the highest-confidence value among same-family duplicates (legacy behavior)", () => {
    const r = buildCertifiedPersonalIncomeYears([
      weak("WAGES_W2", 90_000, 2023, { id: "lo", confidence: 0.4 }),
      weak("WAGES_W2", 91_000, 2023, { id: "hi", confidence: 0.7 }),
    ]);
    assert.equal(y2023(r).wagesW2, 91_000);
  });

  it("alias priority is preserved (SCHED_E_NET wins over SCH_E_RENTAL_TOTAL)", () => {
    const r = buildCertifiedPersonalIncomeYears([
      weak("SCH_E_RENTAL_TOTAL", 12_000),
      weak("SCHED_E_NET", 15_000),
    ]);
    assert.equal(y2023(r).schedENet, 15_000);
  });

  it("numbered K-1 variants are summed (backwards-compat) when no canonical K-1 exists", () => {
    const r = buildCertifiedPersonalIncomeYears([
      weak("K1_ORDINARY_INCOME_2", 40_000),
      weak("K1_ORDINARY_INCOME_3", 25_000),
    ]);
    assert.equal(y2023(r).k1OrdinaryIncome, 65_000);
  });

  it("preserves a legitimate zero and a real loss when there is no contradicting sibling", () => {
    const r = buildCertifiedPersonalIncomeYears([
      strong("TOTAL_TAX", 0),
      strong("ADJUSTED_GROSS_INCOME", -42_000),
    ]);
    const y = y2023(r);
    assert.equal(y.totalTax, 0);
    assert.equal(y.adjustedGrossIncome, -42_000);
  });
});

// ── multi-year ordering ──────────────────────────────────────────────────────────────────────

describe("Phase 3: multi-year handling", () => {
  it("returns years in ascending order with per-year certified winners", () => {
    const r = buildCertifiedPersonalIncomeYears([
      strong("WAGES_W2", 100_000, 2022), weak("WAGES_W2", 2, 2022),
      strong("WAGES_W2", 110_000, 2023), weak("WAGES_W2", 3, 2023),
    ]);
    assert.deepEqual(r.years.map((y) => y.year), [2022, 2023]);
    assert.equal(r.years[0].wagesW2, 100_000);
    assert.equal(r.years[1].wagesW2, 110_000);
  });
});

// ── wiring guard: the server loader delegates to the certified pure core ──────────────────────

describe("Phase 3: loader wiring", () => {
  it("loadPersonalIncome routes through buildCertifiedPersonalIncomeYears and loads the strong family", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/classicSpread/personalIncomeLoader.ts"),
      "utf8",
    );
    assert.ok(/buildCertifiedPersonalIncomeYears/.test(src), "loader delegates to the certified pure core");
    // No longer scoped to ONLY the weak family — must also pull the strong PERSONAL_TAX_RETURN family.
    assert.ok(/source_canonical_type\.eq\.PERSONAL_TAX_RETURN/.test(src), "query includes the strong family");
    assert.ok(!/\.eq\("fact_type",\s*"PERSONAL_INCOME"\)/.test(src), "no longer restricts to fact_type=PERSONAL_INCOME only");
  });
});
