/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream B: construction sizing.
 *
 * Facility = most-restrictive of loan-to-cost and loan-to-as-completed-value;
 * interest reserve carved within the facility; cost-to-complete coverage flag;
 * retainage holdback. Registry-driven (ltc_max, ltv_completed_max,
 * interest_reserve_avg_outstanding, retainage_pct).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sizeConstruction } from "@/lib/finengine/sizing";

// $10M cost, $11M as-completed, 8.5% rate, 18-month build.
const base = { totalProjectCost: 10_000_000, asCompletedValue: 11_000_000, interestRate: 0.085, constructionMonths: 18 };

describe("Workstream B — sizeConstruction", () => {
  it("binds on LTC when cost is the tighter constraint (80% of $10M = $8M < 75% of $11M = $8.25M)", () => {
    const r = sizeConstruction(base);
    assert.equal(r.maxLoan, 8_000_000);
    assert.equal(r.bindingConstraint?.name, "LTC");
  });

  it("binds on as-completed LTV when the completed value is the tighter constraint", () => {
    // $9M as-completed × 75% = $6.75M < $8M LTC.
    const r = sizeConstruction({ ...base, asCompletedValue: 9_000_000 });
    assert.equal(r.maxLoan, 6_750_000);
    assert.equal(r.bindingConstraint?.name, "LTV_COMPLETED");
  });

  it("sizes the interest reserve on average outstanding × rate × months/12", () => {
    // $8M × 0.5 avg × 0.085 × (18/12) = $510,000.
    const r = sizeConstruction(base);
    assert.equal(Math.round(r.interestReserve!), 510_000);
  });

  it("reports implied sponsor equity to cover total project cost", () => {
    const r = sizeConstruction(base);
    assert.equal(r.impliedEquityRequired, 2_000_000); // $10M − $8M
  });

  it("no cost-to-complete gap when loan + provided equity cover total project cost", () => {
    const r = sizeConstruction({ ...base, equity: 2_000_000 });
    assert.equal(r.costToCompleteGap, 0);
  });

  it("flags a cost-to-complete gap when loan + equity fall short", () => {
    const r = sizeConstruction({ ...base, equity: 1_500_000 });
    assert.equal(r.costToCompleteGap, 500_000); // $10M − $8M − $1.5M
    assert.match(r.note, /COST-TO-COMPLETE GAP/);
  });

  it("computes retainage as a pct of total project cost (10% default)", () => {
    const r = sizeConstruction(base);
    assert.equal(r.retainage, 1_000_000);
  });

  it("an explicit avgOutstandingFactor overrides the registry default", () => {
    // $8M × 0.6 × 0.085 × 1.5 = $612,000.
    const r = sizeConstruction({ ...base, avgOutstandingFactor: 0.6 });
    assert.equal(Math.round(r.interestReserve!), 612_000);
  });

  it("is null-safe when project cost and value are absent", () => {
    const r = sizeConstruction({ totalProjectCost: 0, asCompletedValue: 0, interestRate: 0.085, constructionMonths: 18 });
    assert.equal(r.maxLoan, null);
    assert.equal(r.interestReserve, null);
  });
});
