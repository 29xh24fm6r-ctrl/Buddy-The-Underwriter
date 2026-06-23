/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 2) — eligibility rule framework tests.
 *
 * Proves over-90 + concentration parity with the live processor (whole-customer disallow), that the
 * extended categories fire only when enabled AND signaled, single-count breakdown attribution, and
 * that the breakdown sums to total ineligible AR.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyEligibilityRules,
  DEFAULT_ENABLED_CATEGORIES,
  type EligibilityCustomer,
  type IneligibleCategory,
} from "../eligibilityRules";

const cust = (customerName: string, total: number, opts: Partial<EligibilityCustomer> = {}): EligibilityCustomer => ({
  customerName,
  total,
  current: opts.current ?? total,
  d30: opts.d30 ?? 0,
  d60: opts.d60 ?? 0,
  d90: opts.d90 ?? 0,
  d120: opts.d120 ?? 0,
  flags: opts.flags,
});

const config = (enabledCategories: IneligibleCategory[], concentrationLimit = 0.2) => ({
  enabledCategories,
  concentrationLimit,
});

describe("applyEligibilityRules", () => {
  it("disallows the whole customer when any over-90 balance exists (parity with arCollateralProcessor)", () => {
    const r = applyEligibilityRules(
      [cust("A", 1000, { current: 600, d90: 400 }), cust("B", 1000)],
      config(DEFAULT_ENABLED_CATEGORIES, 0.99), // isolate the over-90 rule from concentration
    );
    assert.equal(r.grossAr, 2000);
    assert.equal(r.ineligibleAr, 1000); // A wholly ineligible
    assert.equal(r.eligibleAr, 1000);
    const a = r.customers.find((c) => c.customerName === "A")!;
    assert.equal(a.isIneligible, true);
    assert.ok(a.reasons.includes("over_90_days"));
    assert.ok(a.reasons.includes("cross_aged")); // has both current and >90
  });

  it("marks a customer concentration-ineligible when its share exceeds the limit", () => {
    const r = applyEligibilityRules(
      [cust("Big", 800), cust("S1", 100), cust("S2", 100)],
      config(DEFAULT_ENABLED_CATEGORIES, 0.2),
    );
    assert.equal(r.grossAr, 1000);
    const big = r.customers.find((c) => c.customerName === "Big")!;
    assert.equal(big.concentrationPct, 0.8);
    assert.equal(big.isIneligible, true);
    assert.deepEqual(big.reasons, ["concentration"]);
    assert.equal(r.ineligibleAr, 800);
    assert.equal(r.eligibleAr, 200);
  });

  it("attributes a multi-reason customer to ONE primary reason and sums breakdown to total ineligible", () => {
    // Big customer that is BOTH over-90 and concentrated: counted once, attributed to over_90_days.
    const r = applyEligibilityRules(
      [cust("Big", 800, { current: 400, d120: 400 }), cust("S", 200)],
      config(DEFAULT_ENABLED_CATEGORIES, 0.2),
    );
    const big = r.customers.find((c) => c.customerName === "Big")!;
    assert.equal(big.reasons[0], "over_90_days"); // over_90 has priority over concentration
    const sum = r.ineligibleBreakdown.reduce((s, b) => s + b.amount, 0);
    assert.equal(sum, r.ineligibleAr);
    // Exactly one breakdown row, the over-90 one (not double counted under concentration).
    assert.equal(r.ineligibleBreakdown.length, 1);
    assert.equal(r.ineligibleBreakdown[0].category, "over_90_days");
    assert.equal(r.ineligibleBreakdown[0].customerCount, 1);
  });

  it("extended categories fire only when enabled AND signaled", () => {
    const customers = [
      cust("Affil", 100, { flags: { affiliate: true } }),
      cust("Foreign", 100, { flags: { foreign: true } }),
      cust("Gov", 100, { flags: { government: true } }),
      cust("Clean", 100),
    ];
    // Default policy does NOT enable these — all eligible.
    const off = applyEligibilityRules(customers, config(DEFAULT_ENABLED_CATEGORIES, 0.99));
    assert.equal(off.ineligibleAr, 0);

    // Enable them — the flagged accounts become ineligible.
    const on = applyEligibilityRules(
      customers,
      config([...DEFAULT_ENABLED_CATEGORIES, "affiliate_related_party", "foreign", "government"], 0.99),
    );
    assert.equal(on.ineligibleAr, 300);
    assert.equal(on.eligibleAr, 100);
    const cats = new Set(on.ineligibleBreakdown.map((b) => b.category));
    assert.ok(cats.has("affiliate_related_party") && cats.has("foreign") && cats.has("government"));
  });

  it("treats a zero / malformed total as ineligible (malformed_or_missing_date)", () => {
    const r = applyEligibilityRules([cust("Bad", 0), cust("Good", 500)], config(["malformed_or_missing_date", ...DEFAULT_ENABLED_CATEGORIES]));
    const bad = r.customers.find((c) => c.customerName === "Bad")!;
    assert.equal(bad.isIneligible, true);
    assert.equal(bad.reasons[0], "malformed_or_missing_date");
  });
});
