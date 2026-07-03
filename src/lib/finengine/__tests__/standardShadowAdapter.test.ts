/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 2 tests.
 *
 * The shadow adapter must classify every metric pairing and NEVER mutate/emit.
 * Coverage: matching, divergent, missing (both directions), structural non-metric
 * lines, and unmapped finengine-only names.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compareStandardSpreadShadow,
  compareStandardSpreadAgainstDealSpread,
  dealSpreadToFinengineValues,
  type RenderedMetric,
  type FinengineMetricValue,
} from "@/lib/finengine/spread/standardShadowAdapter";
import type { DealSpread } from "@/lib/finengine/spread/dealSpread";

const P = "2024-12-31";

describe("PR2 — standard spread shadow adapter", () => {
  it("classifies a matching metric (within tolerance)", () => {
    const legacy: RenderedMetric[] = [{ alias: "DSCR", period: P, value: 1.25 }];
    const fin: FinengineMetricValue[] = [{ metric: "DSCR", period: P, value: 1.2500004 }];
    const cmp = compareStandardSpreadShadow(legacy, fin);
    assert.equal(cmp.counts.match, 1);
    assert.equal(cmp.counts.divergent, 0);
    assert.equal(cmp.ok, true);
    assert.equal(cmp.diffs[0].canonicalMetricId, "DSCR");
  });

  it("flags a divergent metric and reports relDiff", () => {
    const legacy: RenderedMetric[] = [{ alias: "CURRENT_RATIO", period: P, value: 2.0 }];
    const fin: FinengineMetricValue[] = [{ metric: "CURRENT_RATIO", period: P, value: 1.5 }];
    const cmp = compareStandardSpreadShadow(legacy, fin);
    assert.equal(cmp.counts.divergent, 1);
    assert.equal(cmp.ok, false);
    assert.ok(cmp.diffs[0].relDiff! > 0.2);
  });

  it("detects a metric missing in finengine", () => {
    const legacy: RenderedMetric[] = [{ alias: "DSCR", period: P, value: 1.4 }];
    const fin: FinengineMetricValue[] = []; // finengine produced nothing
    const cmp = compareStandardSpreadShadow(legacy, fin);
    assert.equal(cmp.counts.missing_in_finengine, 1);
    assert.equal(cmp.ok, true); // missing is informational, not a divergence
  });

  it("treats a finengine null value as missing_in_finengine", () => {
    const legacy: RenderedMetric[] = [{ alias: "DSCR", period: P, value: 1.4 }];
    const fin: FinengineMetricValue[] = [{ metric: "DSCR", period: P, value: null }];
    const cmp = compareStandardSpreadShadow(legacy, fin);
    assert.equal(cmp.counts.missing_in_finengine, 1);
  });

  it("detects a metric missing in legacy (finengine-only, but canonical)", () => {
    const legacy: RenderedMetric[] = [];
    const fin: FinengineMetricValue[] = [{ metric: "CAP_RATE", period: P, value: 0.075 }];
    const cmp = compareStandardSpreadShadow(legacy, fin);
    assert.equal(cmp.counts.missing_in_legacy, 1);
    assert.equal(cmp.diffs[0].canonicalMetricId, "CAP_RATE");
  });

  it("classifies a structural render line as non_metric (no false divergence)", () => {
    const legacy: RenderedMetric[] = [{ alias: "TOTAL_CURRENT_ASSETS", period: P, value: 100 }];
    const fin: FinengineMetricValue[] = [];
    const cmp = compareStandardSpreadShadow(legacy, fin);
    assert.equal(cmp.counts.non_metric, 1);
    assert.equal(cmp.counts.missing_in_finengine, 0);
    assert.equal(cmp.ok, true);
  });

  it("classifies a passthrough render line (raw fact identity) as non_metric", () => {
    const legacy: RenderedMetric[] = [{ alias: "TOTAL_REVENUE", period: P, value: 5_000_000 }];
    const cmp = compareStandardSpreadShadow(legacy, []);
    assert.equal(cmp.counts.non_metric, 1);
  });

  it("marks an unmapped legacy alias", () => {
    const legacy: RenderedMetric[] = [{ alias: "NOT_A_METRIC_XYZ", period: P, value: 3 }];
    const cmp = compareStandardSpreadShadow(legacy, []);
    assert.equal(cmp.counts.unmapped, 1);
  });

  it("marks an unmapped finengine-only metric (e.g. FCCR not in metric registry)", () => {
    const cmp = compareStandardSpreadShadow([], [{ metric: "FCCR", period: P, value: 1.1 }]);
    assert.equal(cmp.counts.unmapped, 1);
    assert.equal(cmp.diffs[0].finengineMetric, "FCCR");
  });

  it("does not double-count a legacy metric that pairs with finengine", () => {
    const legacy: RenderedMetric[] = [{ alias: "DSCR", period: P, value: 1.25 }];
    const fin: FinengineMetricValue[] = [{ metric: "DSCR", period: P, value: 1.25 }];
    const cmp = compareStandardSpreadShadow(legacy, fin);
    assert.equal(cmp.diffs.length, 1);
    assert.equal(cmp.counts.missing_in_legacy, 0);
  });

  it("flattens a DealSpread and compares via the convenience wrapper", () => {
    const spread = {
      dealId: "d1",
      scopes: [],
      snapshots: [],
      warnings: [],
      cells: [
        { metric: "DSCR", period: P, value: 1.3 },
        { metric: "CURRENT_RATIO", period: P, value: 2.1 },
      ],
    } as unknown as DealSpread;
    const values = dealSpreadToFinengineValues(spread);
    assert.equal(values.length, 2);

    const legacy: RenderedMetric[] = [
      { alias: "DSCR", period: P, value: 1.3 },
      { alias: "CURRENT_RATIO", period: P, value: 1.9 }, // divergent
    ];
    const cmp = compareStandardSpreadAgainstDealSpread(legacy, spread);
    assert.equal(cmp.counts.match, 1);
    assert.equal(cmp.counts.divergent, 1);
  });
});
