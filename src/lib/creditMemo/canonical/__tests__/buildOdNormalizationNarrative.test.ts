/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-4 — Narrative Tests
 *
 * Tests:
 * 1. Reviewed/no-addback: describes as operating expense detail
 * 2. Banker-marked addback: includes addback language
 * 3. Banker-marked non-recurring: excluded from normalized earnings
 * 4. Unreconciled detail: notes variance
 * 5. Missing detail: fallback to aggregate-only
 * 6. Omnicare 2024: shows 8.1% ratio with same-year denominator
 * 7. High-risk unmarked items show "requires review"
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOdNormalizationNarrative, type OdFactRow } from "../buildOdNormalizationNarrative";

function makeFact(key: string, value: number, status: string | null = null): OdFactRow {
  return { fact_key: key, fact_value_num: value, fact_period_end: "2024-12-31", resolution_status: status };
}

describe("buildOdNormalizationNarrative", () => {

  it("reviewed/no-addback: describes as reviewed operating expense", () => {
    const result = buildOdNormalizationNarrative(
      [
        makeFact("OD_DETAIL_INSURANCE", 150_000, "banker_reviewed"),
        makeFact("OD_DETAIL_RENT", 100_000, "banker_reviewed"),
        makeFact("OD_DETAIL_TOTAL", 250_000),
        makeFact("OD_DETAIL_RECONCILED", 1),
      ],
      250_000,
      5_000_000,
      2024,
    );
    assert.ok(result.hasDetail);
    assert.equal(result.addbackTotal, 0);
    assert.ok(result.narrative.includes("no adjustment"), "Should note no adjustments");
    assert.ok(result.narrative.includes("reviewed"), "Should note items were reviewed");
  });

  it("banker-marked addback: includes addback language and total", () => {
    const result = buildOdNormalizationNarrative(
      [
        makeFact("OD_DETAIL_OFFICER_COMPENSATION", 200_000, "banker_addback"),
        makeFact("OD_DETAIL_MEALS_ENTERTAINMENT", 50_000, "banker_addback"),
        makeFact("OD_DETAIL_INSURANCE", 100_000, "banker_reviewed"),
        makeFact("OD_DETAIL_TOTAL", 350_000),
      ],
      350_000,
      5_000_000,
      2024,
    );
    assert.equal(result.addbackTotal, 250_000, "Addback total = officer comp + meals");
    assert.ok(result.narrative.includes("marked for addback"));
    assert.ok(result.narrative.includes("$250,000"));
    assert.ok(result.narrative.includes("banker-approved addbacks"));
  });

  it("banker-marked non-recurring: excluded from normalized earnings", () => {
    const result = buildOdNormalizationNarrative(
      [
        makeFact("OD_DETAIL_NON_RECURRING_OR_UNUSUAL", 100_000, "banker_non_recurring"),
        makeFact("OD_DETAIL_INSURANCE", 50_000),
        makeFact("OD_DETAIL_TOTAL", 150_000),
      ],
      150_000,
      3_000_000,
      2024,
    );
    assert.equal(result.nonRecurringTotal, 100_000);
    assert.ok(result.narrative.includes("non-recurring"));
    assert.ok(result.narrative.includes("$100,000"));
  });

  it("unreconciled detail: notes variance", () => {
    const result = buildOdNormalizationNarrative(
      [
        makeFact("OD_DETAIL_INSURANCE", 100_000),
        makeFact("OD_DETAIL_TOTAL", 100_000),
        makeFact("OD_DETAIL_RECONCILED", 0),
      ],
      250_000, // aggregate is $250K but detail only $100K
      5_000_000,
      2024,
    );
    assert.ok(result.narrative.includes("differs"), "Should note variance");
    assert.ok(result.narrative.includes("$150,000"), "Should show variance amount");
  });

  it("missing detail: fallback to aggregate-only", () => {
    const result = buildOdNormalizationNarrative(
      [],
      500_000,
      10_000_000,
      2024,
    );
    assert.equal(result.hasDetail, false);
    assert.ok(result.narrative.includes("not available"));
    assert.ok(result.narrative.includes("$500,000"));
    assert.ok(result.narrative.includes("5.0%"));
  });

  it("Omnicare 2024: shows 8.1% with same-year denominator", () => {
    const result = buildOdNormalizationNarrative(
      [
        makeFact("OD_DETAIL_CONSULTING", 300_000),
        makeFact("OD_DETAIL_MANAGEMENT_FEES", 200_000),
        makeFact("OD_DETAIL_INSURANCE", 1_840_232),
        makeFact("OD_DETAIL_TOTAL", 2_340_232),
        makeFact("OD_DETAIL_RELATED_PARTY_TOTAL", 500_000),
      ],
      2_340_232,
      29_013_467,
      2024,
    );
    assert.ok(result.narrative.includes("8.1%"), "Should show ~8.1% ratio");
    assert.ok(result.narrative.includes("2024"), "Should reference 2024");
    assert.ok(!result.narrative.includes("37.0%"), "Must NOT show 37.0%");
    assert.ok(!result.narrative.includes("2026"), "Must NOT reference 2026");
  });

  it("high-risk unmarked items show 'requires review'", () => {
    const result = buildOdNormalizationNarrative(
      [
        makeFact("OD_DETAIL_RELATED_PARTY_PAYMENTS", 500_000, null), // no status
        makeFact("OD_DETAIL_CONSULTING", 300_000, null),
        makeFact("OD_DETAIL_TOTAL", 800_000),
      ],
      800_000,
      10_000_000,
      2024,
    );
    assert.ok(result.narrative.includes("requires review"), "Unmarked high-risk should say requires review");
  });
});
