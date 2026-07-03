/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 18 tests.
 *
 * Intended divergence vs true (unexpected) mismatch; quality-adjusted; every
 * canonical metric receives a status; unresolved blocks cutover.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compareStandardSpreadShadow, type RenderedMetric, type FinengineMetricValue } from "@/lib/finengine/spread/standardShadowAdapter";
import {
  buildMetricReconciliationMatrix,
  buildProductReconciliation,
  diffProvenance,
  type IntentionalDivergenceRegistry,
} from "@/lib/finengine/shadow/metricReconciliationMatrix";

const P = "2024-12-31";

describe("PR18 — metric reconciliation", () => {
  it("match → zero; unregistered divergence → unexpected → cutover blocked", () => {
    const legacy: RenderedMetric[] = [
      { alias: "DSCR", period: P, value: 1.25 },
      { alias: "CURRENT_RATIO", period: P, value: 2.0 },
    ];
    const fin: FinengineMetricValue[] = [
      { metric: "DSCR", period: P, value: 1.25 }, // match
      { metric: "CURRENT_RATIO", period: P, value: 1.5 }, // divergent, unregistered
    ];
    const cmp = compareStandardSpreadShadow(legacy, fin);
    const m = buildMetricReconciliationMatrix(cmp);
    assert.equal(m.counts.zero, 1);
    assert.equal(m.counts.unexpected, 1);
    assert.equal(m.cutoverBlocked, true);
    assert.equal(m.unresolved[0].canonicalMetricId, "CURRENT_RATIO");
  });

  it("registered intended divergence → intended, NOT blocking", () => {
    const legacy: RenderedMetric[] = [{ alias: "CURRENT_RATIO", period: P, value: 2.0 }];
    const fin: FinengineMetricValue[] = [{ metric: "CURRENT_RATIO", period: P, value: 1.5 }];
    const registry: IntentionalDivergenceRegistry = {
      CURRENT_RATIO: { canonicalMetricId: "CURRENT_RATIO", kind: "legacy_bug", reason: "Legacy double-counted current portion of LTD" },
    };
    const m = buildMetricReconciliationMatrix(compareStandardSpreadShadow(legacy, fin), registry);
    assert.equal(m.counts.intended, 1);
    assert.equal(m.counts.unexpected, 0);
    assert.equal(m.cutoverBlocked, false);
    assert.ok(m.reconciled[0].note.includes("legacy_bug"));
  });

  it("quality-adjusted divergence is distinguished from a true mismatch", () => {
    const legacy: RenderedMetric[] = [{ alias: "EBITDA", period: P, value: 1_000_000 }];
    const fin: FinengineMetricValue[] = [{ metric: "EBITDA", period: P, value: 1_120_000 }]; // quality-adjusted
    const m = buildMetricReconciliationMatrix(
      compareStandardSpreadShadow(legacy, fin),
      {},
      new Set(["EBITDA"]),
    );
    assert.equal(m.counts.quality_adjusted, 1);
    assert.equal(m.cutoverBlocked, false);
  });

  it("every canonical metric receives a status", () => {
    const legacy: RenderedMetric[] = [
      { alias: "DSCR", period: P, value: 1.25 },
      { alias: "TOTAL_CURRENT_ASSETS", period: P, value: 100 }, // structural — excluded
    ];
    const fin: FinengineMetricValue[] = [{ metric: "DSCR", period: P, value: 1.25 }];
    const m = buildMetricReconciliationMatrix(compareStandardSpreadShadow(legacy, fin));
    assert.equal(m.everyCanonicalMetricHasStatus, true);
    // structural line is NOT in the canonical matrix.
    assert.ok(!m.reconciled.some((r) => r.canonicalMetricId === "TOTAL_CURRENT_ASSETS"));
  });

  it("missing on one side → missing status", () => {
    const legacy: RenderedMetric[] = [{ alias: "DSCR", period: P, value: 1.25 }];
    const m = buildMetricReconciliationMatrix(compareStandardSpreadShadow(legacy, []));
    assert.equal(m.counts.missing, 1);
    assert.equal(m.cutoverBlocked, false); // missing is not unresolved-mismatch
  });
});

describe("PR18 — product-specific reconciliation", () => {
  it("blocks cutover if ANY product has an unexpected divergence", () => {
    const clean = compareStandardSpreadShadow([{ alias: "DSCR", period: P, value: 1.2 }], [{ metric: "DSCR", period: P, value: 1.2 }]);
    const dirty = compareStandardSpreadShadow([{ alias: "DSCR", period: P, value: 1.2 }], [{ metric: "DSCR", period: P, value: 0.9 }]);
    const { rollups, cutoverBlocked } = buildProductReconciliation({ CI_TERM: clean, AR_REVOLVER: dirty });
    assert.equal(cutoverBlocked, true);
    assert.equal(rollups.find((r) => r.product === "AR_REVOLVER")!.cutoverBlocked, true);
    assert.equal(rollups.find((r) => r.product === "CI_TERM")!.cutoverBlocked, false);
  });
});

describe("PR18 — provenance diff", () => {
  it("match / mismatch / missing", () => {
    assert.equal(diffProvenance("DSCR", "tax_return:1", "tax_return:1").status, "match");
    assert.equal(diffProvenance("DSCR", "tax_return:1", "deal_spreads:9").status, "mismatch");
    assert.equal(diffProvenance("DSCR", "tax_return:1", null).status, "missing");
  });
});
