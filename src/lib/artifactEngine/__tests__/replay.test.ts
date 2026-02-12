/**
 * Replay & Hardening Tests
 *
 * Validates:
 * - Replay determinism (same inputs → same hashes across runs)
 * - Deep freeze utility (recursive immutability)
 * - Config immutability (nested property mutation throws)
 * - Engine version sourced from package.json
 *
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runFullUnderwrite } from "@/lib/underwritingEngine";
import { computeArtifactHashes } from "../hash";
import { deepFreeze } from "@/lib/utils/deepFreeze";
import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";

// ---------------------------------------------------------------------------
// Fixtures — mirrors underwritingEngine.test.ts
// ---------------------------------------------------------------------------

const STRONG_MODEL: FinancialModel = {
  dealId: "test-replay",
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
// Replay Determinism
// ---------------------------------------------------------------------------

describe("replay determinism", () => {
  it("same inputs produce identical hashes across two runs", () => {
    const result1 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });
    const result2 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });

    assert.ok(result1.diagnostics.pipelineComplete, "Run 1 should complete");
    assert.ok(result2.diagnostics.pipelineComplete, "Run 2 should complete");

    // Cast to successful result type
    const r1 = result1 as { snapshot: unknown; policy: unknown; stress: unknown; pricing: unknown; memo: unknown; analysis: unknown };
    const r2 = result2 as { snapshot: unknown; policy: unknown; stress: unknown; pricing: unknown; memo: unknown; analysis: unknown };

    const hashes1 = computeArtifactHashes({
      model: STRONG_MODEL,
      snapshot: r1.snapshot,
      policy: r1.policy,
      stress: r1.stress,
      pricing: r1.pricing,
      memo: r1.memo,
    });

    const hashes2 = computeArtifactHashes({
      model: STRONG_MODEL,
      snapshot: r2.snapshot,
      policy: r2.policy,
      stress: r2.stress,
      pricing: r2.pricing,
      memo: r2.memo,
    });

    assert.equal(hashes1.modelHash, hashes2.modelHash, "model hash mismatch");
    assert.equal(hashes1.snapshotHash, hashes2.snapshotHash, "snapshot hash mismatch");
    assert.equal(hashes1.policyHash, hashes2.policyHash, "policy hash mismatch");
    assert.equal(hashes1.stressHash, hashes2.stressHash, "stress hash mismatch");
    assert.equal(hashes1.pricingHash, hashes2.pricingHash, "pricing hash mismatch");
    assert.equal(hashes1.memoHash, hashes2.memoHash, "memo hash mismatch");
    assert.equal(hashes1.overallHash, hashes2.overallHash, "overall hash mismatch");
  });

  it("replay with bank config produces same hashes", () => {
    const bankConfig = {
      id: "test-config",
      bankId: "test-bank",
      version: 1,
      policy: {},
      stress: {},
      pricing: {},
    };

    const result1 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
      bankConfig,
    });
    const result2 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
      bankConfig,
    });

    assert.ok(result1.diagnostics.pipelineComplete);
    assert.ok(result2.diagnostics.pipelineComplete);

    const r1 = result1 as { snapshot: unknown; policy: unknown; stress: unknown; pricing: unknown; memo: unknown };
    const r2 = result2 as { snapshot: unknown; policy: unknown; stress: unknown; pricing: unknown; memo: unknown };

    const h1 = computeArtifactHashes({ model: STRONG_MODEL, snapshot: r1.snapshot, policy: r1.policy, stress: r1.stress, pricing: r1.pricing, memo: r1.memo });
    const h2 = computeArtifactHashes({ model: STRONG_MODEL, snapshot: r2.snapshot, policy: r2.policy, stress: r2.stress, pricing: r2.pricing, memo: r2.memo });

    assert.equal(h1.overallHash, h2.overallHash);
  });
});

// ---------------------------------------------------------------------------
// Deep Freeze Utility
// ---------------------------------------------------------------------------

describe("deepFreeze", () => {
  it("freezes top-level object", () => {
    const obj = deepFreeze({ a: 1, b: 2 });
    assert.ok(Object.isFrozen(obj));
  });

  it("freezes nested objects recursively", () => {
    const obj = deepFreeze({ a: { b: { c: 1 } } });
    assert.ok(Object.isFrozen(obj));
    assert.ok(Object.isFrozen(obj.a));
    assert.ok(Object.isFrozen(obj.a.b));
  });

  it("freezes arrays and their elements", () => {
    const obj = deepFreeze({ items: [{ x: 1 }, { x: 2 }] });
    assert.ok(Object.isFrozen(obj.items));
    assert.ok(Object.isFrozen(obj.items[0]));
    assert.ok(Object.isFrozen(obj.items[1]));
  });

  it("handles null and undefined gracefully", () => {
    assert.equal(deepFreeze(null), null);
    assert.equal(deepFreeze(undefined), undefined);
  });

  it("handles primitives gracefully", () => {
    assert.equal(deepFreeze(42), 42);
    assert.equal(deepFreeze("str"), "str");
    assert.equal(deepFreeze(true), true);
  });

  it("mutation of deeply frozen object throws TypeError", () => {
    const obj = deepFreeze({
      policy: {
        thresholds: [{ product: "SBA", metric: "dscr", minimum: 1.25 }],
      },
    });

    assert.throws(() => {
      (obj as any).policy.thresholds[0].minimum = 999;
    }, TypeError);
  });
});

// ---------------------------------------------------------------------------
// Config Immutability (simulates deepFreeze in config loader)
// ---------------------------------------------------------------------------

describe("config immutability", () => {
  it("deeply frozen config rejects nested property mutation", () => {
    const config = deepFreeze({
      id: "test",
      bankId: "bank-1",
      version: 1,
      policy: {
        thresholds: [
          { product: "SBA" as const, metric: "dscr", minimum: 1.25 },
        ],
        minorBreachBand: 0.15,
      },
      stress: { scenarios: [{ key: "REVENUE_DOWN_10" }] },
      pricing: { spreads: { SBA: 275 }, tierPremiums: { A: 0 } },
    });

    // Top-level frozen
    assert.throws(() => { (config as any).id = "hacked"; }, TypeError);

    // Nested policy frozen
    assert.throws(() => { (config as any).policy.minorBreachBand = 0.99; }, TypeError);

    // Deep array element frozen
    assert.throws(() => { (config as any).policy.thresholds[0].minimum = 0; }, TypeError);

    // Nested pricing frozen
    assert.throws(() => { (config as any).pricing.spreads.SBA = 9999; }, TypeError);
  });
});

// ---------------------------------------------------------------------------
// Engine Version
// ---------------------------------------------------------------------------

describe("engine version", () => {
  it("package.json version is a valid semver string", async () => {
    const pkg = await import("../../../../package.json");
    assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  });
});
