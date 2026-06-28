/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream D — sizing→pricing shadow tests.
 *
 * Additive/shadow: reconciles the priced facility against the engine-sized max
 * and flags over-sizing — without changing any borrower-facing price (NG2).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconcileSizingVsPricing, shadowCreSizingVsPricing } from "@/lib/finengine/sizing/sizingPricingShadow";
import { sizeCre } from "@/lib/finengine/sizing";

// A CRE deal: $5M value, $400k NOI, 7% mortgage constant. Engine-sized max ≈ min(LTV, DSCR).
const cre = { propertyValue: 5_000_000, noi: 400_000, annualConstantRate: 0.07, minDebtYield: 0.09 };

describe("Workstream D — sizing→pricing shadow reconciliation", () => {
  it("a priced facility within the engine-sized max reconciles ZERO", () => {
    const sizing = sizeCre(cre);
    assert.ok(sizing.maxLoan != null);
    const r = reconcileSizingVsPricing({ pricedLoanAmount: sizing.maxLoan! - 100_000, sizing });
    assert.equal(r.classification, "ZERO");
    assert.equal(r.withinSizing, true);
    assert.ok(r.headroom! > 0);
    assert.ok(r.bindingConstraint);
  });

  it("a priced facility ABOVE the engine-sized max flags UNEXPECTED with the binding constraint", () => {
    const sizing = sizeCre(cre);
    const r = reconcileSizingVsPricing({ pricedLoanAmount: sizing.maxLoan! + 500_000, sizing });
    assert.equal(r.classification, "UNEXPECTED");
    assert.equal(r.withinSizing, false);
    assert.ok(r.headroom! < 0); // priced above max
    assert.match(r.note, /EXCEEDS engine-sized max/);
  });

  it("a registered exception downgrades an over-size to INTENDED (the override path)", () => {
    const sizing = sizeCre(cre);
    const r = reconcileSizingVsPricing({ pricedLoanAmount: sizing.maxLoan! + 500_000, sizing, intendedReason: "approved policy exception #123" });
    assert.equal(r.classification, "INTENDED");
    assert.match(r.note, /registered exception/);
  });

  it("indeterminate sizing (missing inputs) does not flag", () => {
    const r = reconcileSizingVsPricing({ pricedLoanAmount: 1_000_000, sizing: { constraints: [], bindingConstraint: null, maxLoan: null } });
    assert.equal(r.classification, "ZERO");
    assert.equal(r.withinSizing, null);
  });

  it("the convenience helper sizes from the engine and reconciles in one call; binding constraint flows through", () => {
    // DSCR-bound: NOI 400k / 1.2 floor / 0.07 constant ≈ $4.76M; LTV 0.75×5M = $3.75M → LTV binds.
    const r = shadowCreSizingVsPricing(4_000_000, cre);
    assert.equal(r.bindingConstraint, "LTV"); // 3.75M LTV is the most restrictive
    assert.equal(r.classification, "UNEXPECTED"); // priced 4.0M > 3.75M engine max
    assert.equal(Math.round(r.finengineMaxLoan!), 3_750_000);
  });
});
