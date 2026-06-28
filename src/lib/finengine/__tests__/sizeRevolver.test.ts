/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream D: working-capital revolver.
 *
 * The working-capital gap (AR + inventory − AP) is the PRIMARY size; a
 * revenue-pct cross-check and projected-peak are non-binding sanity checks.
 * Distinct from sizeBorrowingBase (the asset-based AR/inventory advance).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sizeRevolver } from "@/lib/finengine/sizing";

// AR $800k, inventory $500k, AP $400k → gap $900k.
const base = { ar: 800_000, inventory: 500_000, ap: 400_000 };

describe("Workstream D — sizeRevolver", () => {
  it("sizes off the working-capital gap as primary (AR + inventory − AP)", () => {
    const r = sizeRevolver(base);
    assert.equal(r.maxLoan, 900_000);
    assert.equal(r.workingCapitalGap, 900_000);
    assert.equal(r.bindingConstraint?.name, "WORKING_CAPITAL_GAP");
  });

  it("flags when the gap materially exceeds the revenue-pct cross-check", () => {
    // revenue $5M × 10% = $500k < $900k gap → flag for verification.
    const r = sizeRevolver({ ...base, revenue: 5_000_000 });
    assert.equal(r.exceedsRevenueCrossCheck, true);
    const cc = r.constraints.find((c) => c.name === "REVENUE_PCT_CROSSCHECK");
    assert.equal(cc?.maxLoan, 500_000);
  });

  it("does not flag when the gap is within the revenue-pct cross-check", () => {
    // revenue $12M × 10% = $1.2M ≥ $900k gap.
    const r = sizeRevolver({ ...base, revenue: 12_000_000 });
    assert.equal(r.exceedsRevenueCrossCheck, false);
  });

  it("skips the cross-check (null) when revenue is absent — sizing still works", () => {
    const r = sizeRevolver(base);
    assert.equal(r.exceedsRevenueCrossCheck, null);
    assert.equal(r.maxLoan, 900_000);
  });

  it("floors a non-positive gap to 0 (no working-capital line needed)", () => {
    const r = sizeRevolver({ ...base, ap: 2_000_000 }); // 800k + 500k − 2M = −700k
    assert.equal(r.maxLoan, 0);
    assert.equal(r.workingCapitalGap, -700_000);
    assert.match(r.bindingConstraint!.note, /no working-capital financing need/);
  });

  it("reports a projected-peak cross-check when provided", () => {
    const r = sizeRevolver({ ...base, projectedPeakNeed: 1_100_000 });
    const peak = r.constraints.find((c) => c.name === "PROJECTED_PEAK");
    assert.equal(peak?.maxLoan, 1_100_000);
    assert.equal(r.maxLoan, 900_000); // gap stays primary
  });

  it("honors a tenant override on the revenue-pct cross-check (registry, not hardcoded)", () => {
    const r = sizeRevolver({ ...base, revenue: 5_000_000, ctx: { overrides: { revolver_pct_of_revenue: 0.2 } } });
    const cc = r.constraints.find((c) => c.name === "REVENUE_PCT_CROSSCHECK");
    assert.equal(cc?.maxLoan, 1_000_000); // $5M × 20%
    assert.equal(r.exceedsRevenueCrossCheck, false); // $900k ≤ $1M
  });
});
