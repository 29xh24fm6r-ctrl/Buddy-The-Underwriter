/**
 * Model Engine V2 — Controlled Deal Parity Test Harness
 *
 * Runs parity comparisons against real deal IDs from the database.
 * Skipped by default in CI. Enable with:
 *   ENABLE_PARITY_DEALS_TEST=true PARITY_DEAL_IDS=deal1,deal2 node --test
 *
 * This file does NOT import any server-only modules at the top level
 * to avoid breaking test discovery. Database imports are dynamic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

const ENABLED = process.env.ENABLE_PARITY_DEALS_TEST === "true";
const DEAL_IDS = (process.env.PARITY_DEAL_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Pure-function parity smoke tests (always run, no DB)
// ---------------------------------------------------------------------------

describe("parity deals: pure smoke tests", () => {
  it("buildParityReport produces valid shape for empty inputs", async () => {
    const { buildParityReport } = await import("../parity/parityCompare");
    const report = buildParityReport("smoke-test", {}, {});

    assert.equal(report.dealId, "smoke-test");
    assert.equal(typeof report.generatedAt, "string");
    assert.equal(report.periodComparisons.length, 0);
    assert.equal(report.summary.totalDifferences, 0);
    assert.equal(report.summary.materiallyDifferent, false);
  });

  it("compareSpreadToModelV2Pure produces ParityReport", async () => {
    const { compareSpreadToModelV2Pure } = await import("../parity/parityCompare");
    const report = compareSpreadToModelV2Pure(
      "pure-test",
      [], // no V1 spreads
      { dealId: "pure-test", periods: [] }, // empty V2 model
    );

    assert.equal(report.dealId, "pure-test");
    assert.equal(report.periodComparisons.length, 0);
    assert.equal(report.summary.materiallyDifferent, false);
  });

  it("materiality threshold: $0.50 delta is NOT material", async () => {
    const { buildParityReport } = await import("../parity/parityCompare");
    const report = buildParityReport(
      "threshold-test",
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { revenue: 1000000 } } },
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { revenue: 1000000.50 } } },
    );

    assert.equal(report.summary.totalDifferences, 1);
    assert.equal(report.summary.materiallyDifferent, false);

    const revDiff = report.periodComparisons[0]?.differences.revenue;
    assert.ok(revDiff);
    assert.equal(revDiff.material, false);
  });

  it("materiality threshold: $2 delta IS material", async () => {
    const { buildParityReport } = await import("../parity/parityCompare");
    const report = buildParityReport(
      "threshold-test-2",
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { revenue: 1000000 } } },
      { "2024-12-31": { periodEnd: "2024-12-31", metrics: { revenue: 1000002 } } },
    );

    assert.equal(report.summary.materiallyDifferent, true);

    const revDiff = report.periodComparisons[0]?.differences.revenue;
    assert.ok(revDiff);
    assert.equal(revDiff.material, true);
  });
});

// ---------------------------------------------------------------------------
// Live deal parity tests (env-gated, requires DB)
// ---------------------------------------------------------------------------

describe("parity deals: live deal tests", { skip: !ENABLED || DEAL_IDS.length === 0 }, () => {
  for (const dealId of DEAL_IDS) {
    it(`deal ${dealId}: parity comparison completes without error`, async () => {
      // Dynamic imports to avoid server-only at test discovery
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const { compareSpreadToModelV2 } = await import("../parity/parityCompare");

      const sb = supabaseAdmin();
      const report = await compareSpreadToModelV2(dealId, sb);

      assert.equal(report.dealId, dealId);
      assert.equal(typeof report.generatedAt, "string");
      assert.ok(Array.isArray(report.periodComparisons));
      assert.equal(typeof report.summary.totalDifferences, "number");
      assert.equal(typeof report.summary.materiallyDifferent, "boolean");

      // Log summary for debugging (visible in test output)
      console.log(
        `  [${dealId}] periods=${report.periodComparisons.length}` +
        ` diffs=${report.summary.totalDifferences}` +
        ` material=${report.summary.materiallyDifferent}` +
        (report.summary.maxAbsDelta !== undefined ? ` maxDelta=$${report.summary.maxAbsDelta.toFixed(2)}` : ""),
      );
    });

    it(`deal ${dealId}: original comparison (V1→V2) completes without error`, async () => {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const { compareV1toV2 } = await import("../parity/compareV1toV2");
      const { DEFAULT_THRESHOLDS } = await import("../parity/thresholds");

      const sb = supabaseAdmin();
      const result = await compareV1toV2(dealId, sb, DEFAULT_THRESHOLDS);

      assert.equal(result.dealId, dealId);
      assert.ok(["PASS", "FAIL"].includes(result.passFail));
      assert.ok(Array.isArray(result.periods));
      assert.ok(Array.isArray(result.diffs));
      assert.ok(Array.isArray(result.headline));
      assert.ok(Array.isArray(result.flags));

      console.log(
        `  [${dealId}] verdict=${result.passFail}` +
        ` periods=${result.periods.length}` +
        ` diffs=${result.diffs.length}` +
        ` flags=${result.flags.length}`,
      );
    });
  }
});
