/**
 * Config Engine — Tests
 *
 * Tests config override merging, system defaults, and engine integration.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import type { PolicyConfigOverride, PricingConfigOverride } from "../types";
import {
  DEFAULT_MINOR_BREACH_BAND,
  DEFAULT_THRESHOLDS,
  DEFAULT_SPREADS_BPS,
  DEFAULT_TIER_PREMIUMS_BPS,
  DEFAULT_STRESS_ADJUST_BPS_PER_TIER,
} from "../defaults";
import { evaluatePolicy } from "@/lib/policyEngine/evaluator";
import { computePricing } from "@/lib/pricingEngine";
import { runFullUnderwrite } from "@/lib/underwritingEngine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STRONG_MODEL: FinancialModel = {
  dealId: "test-config",
  periods: [
    {
      periodId: "fy-2024",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: {
        revenue: 1_000_000,
        cogs: 400_000,
        operatingExpenses: 200_000,
        depreciation: 50_000,
        interest: 30_000,
        netIncome: 320_000,
      },
      balance: {
        cash: 100_000,
        accountsReceivable: 80_000,
        inventory: 60_000,
        totalAssets: 2_000_000,
        shortTermDebt: 50_000,
        longTermDebt: 500_000,
        totalLiabilities: 800_000,
        equity: 1_200_000,
      },
      cashflow: {
        ebitda: 400_000,
        capex: 50_000,
      },
      qualityFlags: [],
    },
  ],
};

const INSTRUMENTS: DebtInstrument[] = [
  {
    id: "sba-loan",
    source: "proposed",
    principal: 500_000,
    rate: 0.065,
    amortizationMonths: 300,
    paymentFrequency: "monthly",
  },
];

// ---------------------------------------------------------------------------
// Defaults Tests
// ---------------------------------------------------------------------------

describe("System Defaults", () => {
  it("minor breach band is 0.15", () => {
    assert.equal(DEFAULT_MINOR_BREACH_BAND, 0.15);
  });

  it("has thresholds for all 5 products", () => {
    const products = new Set(DEFAULT_THRESHOLDS.map((t) => t.product));
    assert.ok(products.has("SBA"));
    assert.ok(products.has("LOC"));
    assert.ok(products.has("EQUIPMENT"));
    assert.ok(products.has("ACQUISITION"));
    assert.ok(products.has("CRE"));
  });

  it("SBA default DSCR minimum is 1.25", () => {
    const sba = DEFAULT_THRESHOLDS.find(
      (t) => t.product === "SBA" && t.metric === "dscr",
    );
    assert.ok(sba);
    assert.equal(sba.minimum, 1.25);
  });

  it("spread defaults match rate table", () => {
    assert.equal(DEFAULT_SPREADS_BPS.SBA, 275);
    assert.equal(DEFAULT_SPREADS_BPS.CRE, 225);
    assert.equal(DEFAULT_SPREADS_BPS.LOC, 150);
  });

  it("tier premium defaults match risk premium table", () => {
    assert.equal(DEFAULT_TIER_PREMIUMS_BPS.A, 0);
    assert.equal(DEFAULT_TIER_PREMIUMS_BPS.B, 50);
    assert.equal(DEFAULT_TIER_PREMIUMS_BPS.C, 125);
    assert.equal(DEFAULT_TIER_PREMIUMS_BPS.D, 300);
  });

  it("stress adjust default is 25bps per tier", () => {
    assert.equal(DEFAULT_STRESS_ADJUST_BPS_PER_TIER, 25);
  });
});

// ---------------------------------------------------------------------------
// Policy Config Override Tests
// ---------------------------------------------------------------------------

describe("Policy with config override", () => {
  it("no config = system defaults (backward compatible)", () => {
    // Run without config — should produce tier A for strong model
    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });
    assert.ok(result.diagnostics.pipelineComplete);
    assert.equal((result as any).policy.tier, "A");
  });

  it("stricter DSCR threshold can change tier", () => {
    // Default SBA DSCR min is 1.25. Model has DSCR ~2.5+.
    // Set absurdly high threshold to force breach.
    const strictConfig: PolicyConfigOverride = {
      thresholds: [
        { product: "SBA", metric: "dscr", minimum: 100 },
      ],
    };

    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
      bankConfig: {
        id: "test",
        bankId: "test-bank",
        version: 1,
        policy: strictConfig,
        stress: {},
        pricing: {},
      },
    });

    assert.ok(result.diagnostics.pipelineComplete);
    // Should fail policy check due to absurdly high DSCR requirement
    assert.notEqual((result as any).policy.tier, "A");
    assert.equal((result as any).policy.passed, false);
  });

  it("custom minor breach band changes severity classification", () => {
    // Very wide breach band makes everything "minor"
    const wideConfig: PolicyConfigOverride = {
      thresholds: [
        { product: "SBA", metric: "dscr", minimum: 100 },
      ],
      minorBreachBand: 0.99, // 99% = everything is minor
    };

    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
      bankConfig: {
        id: "test",
        bankId: "test-bank",
        version: 1,
        policy: wideConfig,
        stress: {},
        pricing: {},
      },
    });

    assert.ok(result.diagnostics.pipelineComplete);
    const policy = (result as any).policy;
    // Should have breach but all minor (due to wide band)
    assert.ok(policy.breaches.length > 0);
    assert.ok(policy.breaches.every((b: any) => b.severity === "minor"));
    // With only minor breaches, tier should be B (not C or D)
    assert.equal(policy.tier, "B");
  });
});

// ---------------------------------------------------------------------------
// Pricing Config Override Tests
// ---------------------------------------------------------------------------

describe("Pricing with config override", () => {
  it("no config = system default rate", () => {
    const result = computePricing({ product: "SBA", tier: "A" });
    assert.ok(Math.abs(result.baseRate - 0.1125) < 0.0001);
  });

  it("custom spread override changes base rate", () => {
    const config: PricingConfigOverride = {
      spreads: { SBA: 500 }, // 500bps instead of 275bps
    };

    const result = computePricing({ product: "SBA", tier: "A", config });
    // PRIME (8.50%) + 500bps = 13.50%
    assert.ok(
      Math.abs(result.baseRate - 0.135) < 0.0001,
      `Expected ~0.135, got ${result.baseRate}`,
    );
  });

  it("custom tier premium override changes risk premium", () => {
    const config: PricingConfigOverride = {
      tierPremiums: { B: 200 }, // 200bps instead of 50bps
    };

    const result = computePricing({ product: "SBA", tier: "B", config });
    assert.equal(result.riskPremiumBps, 200);
  });

  it("custom stress adjust bps per tier", () => {
    const config: PricingConfigOverride = {
      stressAdjustBpsPerTier: 50, // 50bps instead of 25bps
    };

    const result = computePricing({
      product: "SBA",
      tier: "A",
      stressedTier: "C",
      config,
    });
    // 2 tier degradation (A→C) × 50bps = 100bps
    assert.equal(result.stressAdjustmentBps, 100);
  });

  it("unset product spread falls back to default", () => {
    const config: PricingConfigOverride = {
      spreads: { LOC: 300 }, // Only override LOC, not SBA
    };

    const result = computePricing({ product: "SBA", tier: "A", config });
    // SBA should still use default 275bps
    assert.ok(
      Math.abs(result.baseRate - 0.1125) < 0.0001,
      `Expected ~0.1125, got ${result.baseRate}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Full Pipeline with Config Tests
// ---------------------------------------------------------------------------

describe("runFullUnderwrite with bank config", () => {
  it("empty config = identical to no config", () => {
    const r1 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });

    const r2 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
      bankConfig: {
        id: "empty",
        bankId: "test-bank",
        version: 1,
        policy: {},
        stress: {},
        pricing: {},
      },
    });

    assert.ok(r1.diagnostics.pipelineComplete);
    assert.ok(r2.diagnostics.pipelineComplete);
    assert.equal((r1 as any).policy.tier, (r2 as any).policy.tier);
    assert.equal((r1 as any).pricing.finalRate, (r2 as any).pricing.finalRate);
    assert.equal((r1 as any).memo.recommendation, (r2 as any).memo.recommendation);
  });

  it("different bank configs can produce different tiers", () => {
    // Lenient config: very low DSCR requirement
    const lenient = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
      bankConfig: {
        id: "lenient",
        bankId: "test-bank",
        version: 1,
        policy: {
          thresholds: [
            { product: "SBA", metric: "dscr", minimum: 0.5 },
            { product: "SBA", metric: "leverage", maximum: 100 },
          ],
        },
        stress: {},
        pricing: {},
      },
    });

    // Strict config: impossibly high requirement
    const strict = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
      bankConfig: {
        id: "strict",
        bankId: "test-bank",
        version: 1,
        policy: {
          thresholds: [
            { product: "SBA", metric: "dscr", minimum: 100 },
          ],
        },
        stress: {},
        pricing: {},
      },
    });

    assert.ok(lenient.diagnostics.pipelineComplete);
    assert.ok(strict.diagnostics.pipelineComplete);
    assert.equal((lenient as any).policy.tier, "A");
    assert.notEqual((strict as any).policy.tier, "A");
  });
});
