/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-5 — Adjustment Tests
 *
 * Tests:
 * 1. banker_addback line included in adjustments
 * 2. banker_non_recurring line included in adjustments
 * 3. banker_reviewed excluded (no adjustment)
 * 4. null/unmarked status excluded (disclosure only)
 * 5. summary keys excluded from adjustments
 * 6. multi-year facts isolated correctly
 * 7. duplicate prevention (same builder, different consumers)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildOdNormalizedEarningsAdjustments,
  type OdFactInput,
} from "../buildOdNormalizedEarningsAdjustments";

function makeFact(key: string, value: number, status: string | null, year: number = 2024): OdFactInput {
  return {
    id: `fact-${key}-${year}`,
    fact_key: key,
    fact_value_num: value,
    fact_period_end: `${year}-12-31`,
    resolution_status: status,
  };
}

describe("buildOdNormalizedEarningsAdjustments", () => {

  it("includes banker_addback line in adjustments", () => {
    const result = buildOdNormalizedEarningsAdjustments([
      makeFact("OD_DETAIL_OFFICER_COMPENSATION", 200_000, "banker_addback"),
    ], 2024);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.addbackTotal, 200_000);
    assert.equal(result.adjustments[0].adjustmentType, "addback");
    assert.equal(result.adjustments[0].category, "OFFICER_COMPENSATION");
  });

  it("includes banker_non_recurring line in adjustments", () => {
    const result = buildOdNormalizedEarningsAdjustments([
      makeFact("OD_DETAIL_NON_RECURRING_OR_UNUSUAL", 100_000, "banker_non_recurring"),
    ], 2024);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.nonRecurringTotal, 100_000);
    assert.equal(result.adjustments[0].adjustmentType, "non_recurring");
  });

  it("excludes banker_reviewed (no adjustment)", () => {
    const result = buildOdNormalizedEarningsAdjustments([
      makeFact("OD_DETAIL_INSURANCE", 150_000, "banker_reviewed"),
    ], 2024);
    assert.equal(result.adjustments.length, 0);
    assert.equal(result.totalAdjustment, 0);
  });

  it("excludes null/unmarked status (disclosure only)", () => {
    const result = buildOdNormalizedEarningsAdjustments([
      makeFact("OD_DETAIL_CONSULTING", 300_000, null),
      makeFact("OD_DETAIL_MANAGEMENT_FEES", 200_000, null),
    ], 2024);
    assert.equal(result.adjustments.length, 0);
    assert.equal(result.totalAdjustment, 0);
  });

  it("excludes summary keys from adjustments", () => {
    const result = buildOdNormalizedEarningsAdjustments([
      makeFact("OD_DETAIL_TOTAL", 500_000, "banker_addback"),
      makeFact("OD_DETAIL_RELATED_PARTY_TOTAL", 200_000, "banker_addback"),
      makeFact("OD_DETAIL_POTENTIAL_ADDBACK_TOTAL", 300_000, "banker_addback"),
      makeFact("OD_DETAIL_RECONCILED", 1, "banker_addback"),
    ], 2024);
    assert.equal(result.adjustments.length, 0, "Summary keys must not produce adjustments");
  });

  it("isolates facts by year correctly", () => {
    const result = buildOdNormalizedEarningsAdjustments([
      makeFact("OD_DETAIL_CONSULTING", 100_000, "banker_addback", 2024),
      makeFact("OD_DETAIL_CONSULTING", 80_000, "banker_addback", 2023),
      makeFact("OD_DETAIL_RENT", 50_000, "banker_addback", 2024),
    ], 2024);
    assert.equal(result.adjustments.length, 2, "Only 2024 items should be included");
    assert.equal(result.addbackTotal, 150_000, "Total = consulting 2024 + rent 2024");
  });

  it("computes totalAdjustment as sum of addback + non_recurring", () => {
    const result = buildOdNormalizedEarningsAdjustments([
      makeFact("OD_DETAIL_OFFICER_COMPENSATION", 200_000, "banker_addback"),
      makeFact("OD_DETAIL_MEALS_ENTERTAINMENT", 50_000, "banker_addback"),
      makeFact("OD_DETAIL_NON_RECURRING_OR_UNUSUAL", 100_000, "banker_non_recurring"),
      makeFact("OD_DETAIL_INSURANCE", 75_000, "banker_reviewed"), // excluded
    ], 2024);
    assert.equal(result.addbackTotal, 250_000);
    assert.equal(result.nonRecurringTotal, 100_000);
    assert.equal(result.totalAdjustment, 350_000);
    assert.equal(result.adjustments.length, 3);
  });
});
