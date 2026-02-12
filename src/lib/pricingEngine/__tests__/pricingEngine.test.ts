/**
 * Pricing Engine — Tests
 *
 * Tests base rates, risk premiums, stress adjustments, and full pricing.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ProductType } from "@/lib/creditLenses/types";
import type { RiskTier } from "@/lib/policyEngine/types";
import { getBaseRate, INDEX_RATES } from "../rateTable";
import { getRiskPremiumBps } from "../riskPremium";
import { getStressAdjustmentBps } from "../stressAdjust";
import { computePricing } from "../index";

// ---------------------------------------------------------------------------
// Index Constants
// ---------------------------------------------------------------------------

describe("Index Rates", () => {
  it("Prime is 8.50%", () => {
    assert.equal(INDEX_RATES.PRIME, 0.085);
  });

  it("SOFR is 4.33%", () => {
    assert.equal(INDEX_RATES.SOFR, 0.0433);
  });
});

// ---------------------------------------------------------------------------
// Base Rate Table
// ---------------------------------------------------------------------------

describe("Base Rate Table", () => {
  const expectedRates: Array<[ProductType, number]> = [
    ["SBA", 0.1125],       // 8.50% + 275bps
    ["LOC", 0.1000],       // 8.50% + 150bps
    ["EQUIPMENT", 0.1050], // 8.50% + 200bps
    ["ACQUISITION", 0.1150], // 8.50% + 300bps
    ["CRE", 0.0658],       // 4.33% + 225bps
  ];

  for (const [product, expectedRate] of expectedRates) {
    it(`${product} base rate is ${(expectedRate * 100).toFixed(2)}%`, () => {
      const entry = getBaseRate(product);
      assert.ok(
        Math.abs(entry.baseRate - expectedRate) < 0.0001,
        `Expected ${expectedRate}, got ${entry.baseRate}`,
      );
    });
  }

  it("all 5 products have entries", () => {
    const products: ProductType[] = ["SBA", "LOC", "EQUIPMENT", "ACQUISITION", "CRE"];
    for (const p of products) {
      const entry = getBaseRate(p);
      assert.ok(entry, `Missing entry for ${p}`);
      assert.ok(entry.baseRate > 0, `Base rate for ${p} must be positive`);
    }
  });

  it("SBA uses PRIME index", () => {
    assert.equal(getBaseRate("SBA").index, "PRIME");
  });

  it("CRE uses SOFR index", () => {
    assert.equal(getBaseRate("CRE").index, "SOFR");
  });
});

// ---------------------------------------------------------------------------
// Risk Premium
// ---------------------------------------------------------------------------

describe("Risk Premium", () => {
  const expected: Array<[RiskTier, number]> = [
    ["A", 0],
    ["B", 50],
    ["C", 125],
    ["D", 300],
  ];

  for (const [tier, bps] of expected) {
    it(`Tier ${tier} → +${bps}bps`, () => {
      assert.equal(getRiskPremiumBps(tier), bps);
    });
  }
});

// ---------------------------------------------------------------------------
// Stress Adjustment
// ---------------------------------------------------------------------------

describe("Stress Adjustment", () => {
  it("no stressed tier → 0bps", () => {
    assert.equal(getStressAdjustmentBps("A", undefined), 0);
  });

  it("same tier → 0bps", () => {
    assert.equal(getStressAdjustmentBps("B", "B"), 0);
  });

  it("better stressed tier → 0bps", () => {
    assert.equal(getStressAdjustmentBps("C", "B"), 0);
  });

  it("1 tier degradation → +25bps", () => {
    assert.equal(getStressAdjustmentBps("A", "B"), 25);
  });

  it("2 tier degradation → +50bps", () => {
    assert.equal(getStressAdjustmentBps("A", "C"), 50);
  });

  it("3 tier degradation → +75bps", () => {
    assert.equal(getStressAdjustmentBps("A", "D"), 75);
  });
});

// ---------------------------------------------------------------------------
// Full Pricing
// ---------------------------------------------------------------------------

describe("computePricing", () => {
  it("SBA tier A — base rate only", () => {
    const result = computePricing({ product: "SBA", tier: "A" });
    assert.ok(Math.abs(result.baseRate - 0.1125) < 0.0001);
    assert.equal(result.riskPremiumBps, 0);
    assert.equal(result.stressAdjustmentBps, 0);
    assert.ok(Math.abs(result.finalRate - 0.1125) < 0.0001);
  });

  it("SBA tier B — adds 50bps", () => {
    const result = computePricing({ product: "SBA", tier: "B" });
    // 11.25% + 0.50% = 11.75%
    assert.ok(Math.abs(result.finalRate - 0.1175) < 0.0001);
  });

  it("CRE tier C with stress degradation B→D", () => {
    const result = computePricing({
      product: "CRE",
      tier: "C",
      stressedTier: "D",
    });
    // Base: 6.58% + 125bps risk + 25bps stress (C→D = 1 tier) = 6.58 + 1.25 + 0.25 = 8.08%
    assert.equal(result.riskPremiumBps, 125);
    assert.equal(result.stressAdjustmentBps, 25);
    assert.ok(
      Math.abs(result.finalRate - 0.0808) < 0.0001,
      `Expected ~0.0808, got ${result.finalRate}`,
    );
  });

  it("includes rationale strings", () => {
    const result = computePricing({ product: "SBA", tier: "B", stressedTier: "C" });
    assert.ok(result.rationale.length >= 3);
    assert.ok(result.rationale.some((r) => r.includes("Base rate")));
    assert.ok(result.rationale.some((r) => r.includes("Risk premium")));
    assert.ok(result.rationale.some((r) => r.includes("Stress adjustment")));
  });

  it("is deterministic", () => {
    const r1 = computePricing({ product: "ACQUISITION", tier: "C", stressedTier: "D" });
    const r2 = computePricing({ product: "ACQUISITION", tier: "C", stressedTier: "D" });
    assert.equal(r1.finalRate, r2.finalRate);
    assert.equal(r1.riskPremiumBps, r2.riskPremiumBps);
    assert.equal(r1.stressAdjustmentBps, r2.stressAdjustmentBps);
  });
});
