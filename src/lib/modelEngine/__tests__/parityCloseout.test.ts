/**
 * Phase 2 Closeout — Parity Closeout Tests
 *
 * Tests:
 * - Metric dictionary freeze (exactly 10, no duplicates)
 * - parityTargets returns only dictionary keys
 * - Missing-metric behavior (explicit, no coercion to 0)
 * - Golden report snapshot test (stable shape)
 * - Route validation helpers
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// 1) Metric dictionary freeze tests
// ---------------------------------------------------------------------------

describe("metricDictionary: freeze", () => {
  it("contains exactly 10 canonical metrics", async () => {
    const {
      CANONICAL_PARITY_METRICS,
      EXPECTED_METRIC_COUNT,
    } = await import("../parity/metricDictionary");
    assert.equal(CANONICAL_PARITY_METRICS.length, EXPECTED_METRIC_COUNT);
    assert.equal(CANONICAL_PARITY_METRICS.length, 10);
  });

  it("has no duplicate keys", async () => {
    const { CANONICAL_PARITY_METRICS } = await import("../parity/metricDictionary");
    const keys = CANONICAL_PARITY_METRICS.map((m) => m.key);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, `Duplicate keys: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);
  });

  it("CANONICAL_PARITY_METRIC_KEYS matches CANONICAL_PARITY_METRICS keys", async () => {
    const {
      CANONICAL_PARITY_METRICS,
      CANONICAL_PARITY_METRIC_KEYS,
    } = await import("../parity/metricDictionary");
    const expected = CANONICAL_PARITY_METRICS.map((m) => m.key);
    assert.deepEqual([...CANONICAL_PARITY_METRIC_KEYS], expected);
  });

  it("every metric has a non-empty description", async () => {
    const { CANONICAL_PARITY_METRICS } = await import("../parity/metricDictionary");
    for (const m of CANONICAL_PARITY_METRICS) {
      assert.ok(m.description.length > 0, `${m.key} has empty description`);
    }
  });

  it("every metric has a valid category", async () => {
    const { CANONICAL_PARITY_METRICS } = await import("../parity/metricDictionary");
    const validCategories = new Set(["income_statement", "balance_sheet", "derived"]);
    for (const m of CANONICAL_PARITY_METRICS) {
      assert.ok(validCategories.has(m.category), `${m.key} has invalid category: ${m.category}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2) parityTargets returns only dictionary keys
// ---------------------------------------------------------------------------

describe("parityTargets: dictionary alignment", () => {
  it("PARITY_METRIC_KEYS matches canonical dictionary", async () => {
    const { PARITY_METRIC_KEYS } = await import("../parity/parityTargets");
    const { CANONICAL_PARITY_METRIC_KEYS } = await import("../parity/metricDictionary");
    assert.deepEqual([...PARITY_METRIC_KEYS], [...CANONICAL_PARITY_METRIC_KEYS]);
  });
});

// ---------------------------------------------------------------------------
// 3) Missing-metric behavior tests
// ---------------------------------------------------------------------------

describe("parityCompare: missing-metric behavior", () => {
  it("missing spread metric → note logged, diff not counted", async () => {
    const { buildParityReport } = await import("../parity/parityCompare");
    const report = buildParityReport(
      "missing-spread",
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: {} } }, // spread: no revenue
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { revenue: 1000000 } } }, // model: has revenue
    );

    // Should NOT coerce missing spread to 0
    assert.equal(report.summary.totalDifferences, 0);
    assert.equal(report.summary.materiallyDifferent, false);
    // Should log a note
    assert.ok(report.notes);
    assert.ok(report.notes.some((n) => n.includes("revenue") && n.includes("not in V1 spread")));
    // Should NOT have a diff entry for revenue
    const revDiff = report.periodComparisons[0]?.differences.revenue;
    assert.equal(revDiff, undefined);
  });

  it("missing model metric → note logged, diff not counted", async () => {
    const { buildParityReport } = await import("../parity/parityCompare");
    const report = buildParityReport(
      "missing-model",
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { revenue: 1000000 } } },
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: {} } },
    );

    assert.equal(report.summary.totalDifferences, 0);
    assert.equal(report.summary.materiallyDifferent, false);
    assert.ok(report.notes);
    assert.ok(report.notes.some((n) => n.includes("revenue") && n.includes("not in V2 model")));
    const revDiff = report.periodComparisons[0]?.differences.revenue;
    assert.equal(revDiff, undefined);
  });

  it("both missing → no note for that metric, no diff", async () => {
    const { buildParityReport } = await import("../parity/parityCompare");
    const report = buildParityReport(
      "both-missing",
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { cash: 50000 } } },
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { cash: 50000 } } },
    );

    // revenue is missing on both sides — should be silently skipped
    assert.equal(report.summary.totalDifferences, 0);
    assert.equal(report.summary.materiallyDifferent, false);
    // No notes about revenue (both missing = silent skip)
    const revenueNotes = (report.notes ?? []).filter((n) => n.includes("revenue"));
    assert.equal(revenueNotes.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 4) Golden report snapshot test (stable shape)
// ---------------------------------------------------------------------------

describe("parityCompare: golden report shape", () => {
  it("produces stable report shape for known input", async () => {
    const { buildParityReport } = await import("../parity/parityCompare");
    const report = buildParityReport(
      "golden-test",
      {
        "2024-12-31": {
          periodEnd: "2024-12-31",
          metrics: { revenue: 1000000, totalAssets: 5000000, ebitda: 400000 },
        },
      },
      {
        "2024-12-31": {
          periodEnd: "2024-12-31",
          metrics: { revenue: 1000000, totalAssets: 5000001, ebitda: 400000 },
        },
      },
    );

    // Shape assertions
    assert.equal(report.dealId, "golden-test");
    assert.equal(typeof report.generatedAt, "string");
    assert.equal(report.periodComparisons.length, 1);

    const pc = report.periodComparisons[0];
    assert.equal(pc.periodId, "2024-12-31");
    assert.equal(pc.periodEnd, "2024-12-31");

    // Revenue: exact match (delta=0)
    const revDiff = pc.differences.revenue;
    assert.ok(revDiff);
    assert.equal(revDiff.spread, 1000000);
    assert.equal(revDiff.model, 1000000);
    assert.equal(revDiff.delta, 0);
    assert.equal(revDiff.material, false);

    // totalAssets: $1 diff — material (abs > 1)
    const taDiff = pc.differences.totalAssets;
    assert.ok(taDiff);
    assert.equal(taDiff.spread, 5000000);
    assert.equal(taDiff.model, 5000001);
    assert.equal(taDiff.delta, 1);
    assert.equal(taDiff.material, false); // abs(1) is NOT > 1

    // EBITDA: exact match
    const ebitdaDiff = pc.differences.ebitda;
    assert.ok(ebitdaDiff);
    assert.equal(ebitdaDiff.delta, 0);
    assert.equal(ebitdaDiff.material, false);

    // Summary
    assert.equal(report.summary.totalDifferences, 1); // totalAssets has delta=1
    assert.equal(report.summary.materiallyDifferent, false); // $1 is not material
    assert.equal(report.summary.maxAbsDelta, 1);
  });
});

// ---------------------------------------------------------------------------
// 5) Route validation helpers (pure function tests)
// ---------------------------------------------------------------------------

describe("parity route: input validation", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const VALID_FORMATS = new Set(["json", "markdown"]);

  function validateDealId(dealId: string): string | null {
    if (!UUID_RE.test(dealId)) return "invalid_deal_id: must be UUID";
    return null;
  }

  function validatePeriod(period: string | null): string | null {
    if (period === null) return null;
    if (!DATE_RE.test(period)) return "invalid_period: must be YYYY-MM-DD";
    return null;
  }

  function validateFormat(format: string | null): string | null {
    if (format === null) return null;
    if (!VALID_FORMATS.has(format)) return "invalid_format";
    return null;
  }

  it("accepts valid UUID", () => {
    assert.equal(validateDealId("098850d1-1234-5678-abcd-ef0123456789"), null);
  });

  it("rejects non-UUID dealId", () => {
    assert.ok(validateDealId("not-a-uuid") !== null);
    assert.ok(validateDealId("") !== null);
    assert.ok(validateDealId("../../../etc/passwd") !== null);
  });

  it("accepts valid period", () => {
    assert.equal(validatePeriod("2024-12-31"), null);
    assert.equal(validatePeriod(null), null); // null = no filter
  });

  it("rejects invalid period", () => {
    assert.ok(validatePeriod("Dec 2024") !== null);
    assert.ok(validatePeriod("2024/12/31") !== null);
    assert.ok(validatePeriod("not-a-date") !== null);
  });

  it("accepts valid format", () => {
    assert.equal(validateFormat("json"), null);
    assert.equal(validateFormat("markdown"), null);
    assert.equal(validateFormat(null), null);
  });

  it("rejects invalid format", () => {
    assert.ok(validateFormat("xml") !== null);
    assert.ok(validateFormat("html") !== null);
  });
});
