/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream B — regression-gate tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runSpreadRegression, type RegressionDeal } from "@/lib/finengine/spread/spreadRegression";
import { REGRESSION_DEALS } from "@/lib/finengine/__tests__/__fixtures__/regressionDeals";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const biz = (k: string, p: string, v: number): CertifiedFactRow =>
  ({ fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: false, created_at: "2026-06-01T00:00:00Z" });

describe("Workstream B — spread regression gate", () => {
  it("passes clean on the committed fixture deals (the gate's steady state)", () => {
    const report = runSpreadRegression(REGRESSION_DEALS);
    assert.equal(report.failed, false, report.results.flatMap((r) => r.unexpectedDetails).join("; "));
    assert.equal(report.totalUnexpected, 0);
    assert.ok(report.results.length >= 3);
  });

  it("FAILS the build on a seeded UNEXPECTED divergence (wrong audited anchor)", () => {
    const broken: RegressionDeal = {
      id: "broken", name: "seeded divergence",
      rows: [biz("M1_TAXABLE_INCOME", "2024-12-31", 200925), biz("NET_INCOME", "2024-12-31", 200925), biz("DEPRECIATION", "2024-12-31", 210207)],
      hardAnchors: [{ metric: "EBITDA", period: "2024-12-31", expected: 999_999, source: "deliberately wrong audited anchor" }],
    };
    const report = runSpreadRegression([broken]);
    assert.equal(report.failed, true);
    assert.ok(report.totalUnexpected >= 1);
    assert.ok(report.results[0].unexpectedDetails.some((d) => d.includes("ANCHOR:EBITDA")));
  });

  it("a registered INTENDED divergence does NOT fail the gate (the override path)", () => {
    const intended: RegressionDeal = {
      id: "intended", name: "registered exception",
      rows: [biz("M1_TAXABLE_INCOME", "2024-12-31", 200925), biz("NET_INCOME", "2024-12-31", 200925), biz("DEPRECIATION", "2024-12-31", 210207)],
      hardAnchors: [{ metric: "EBITDA", period: "2024-12-31", expected: 999_999, source: "anchor" }],
      intended: [{ metric: "EBITDA", period: "2024-12-31", expected: 411132, rationale: "registered for the test" }],
    };
    const report = runSpreadRegression([intended]);
    assert.equal(report.failed, false); // engine 411,132 matches the registered INTENDED expectation
  });
});
