/**
 * Underwriting Engine — Tests
 *
 * Tests the full pipeline orchestrator.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import { runFullUnderwrite } from "../index";
import type { UnderwriteResult, UnderwriteFailure } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSuccess(r: UnderwriteResult | UnderwriteFailure): r is UnderwriteResult {
  return r.diagnostics.pipelineComplete === true;
}

function isFailure(r: UnderwriteResult | UnderwriteFailure): r is UnderwriteFailure {
  return r.diagnostics.pipelineComplete === false;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STRONG_MODEL: FinancialModel = {
  dealId: "test-strong",
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
// Full Pipeline Tests
// ---------------------------------------------------------------------------

describe("runFullUnderwrite", () => {
  it("completes full pipeline with strong model", () => {
    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });

    assert.ok(isSuccess(result), "Pipeline should complete");
    assert.ok(result.snapshot);
    assert.ok(result.analysis);
    assert.ok(result.policy);
    assert.ok(result.stress);
    assert.ok(result.pricing);
    assert.ok(result.memo);
    assert.equal(result.diagnostics.pipelineComplete, true);
  });

  it("strong SBA borrower gets tier A", () => {
    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });

    assert.ok(isSuccess(result));
    assert.equal(result.policy.tier, "A");
  });

  it("SBA pricing has correct base rate", () => {
    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });

    assert.ok(isSuccess(result));
    assert.ok(
      Math.abs(result.pricing.baseRate - 0.1125) < 0.0001,
      `Expected base rate ~0.1125, got ${result.pricing.baseRate}`,
    );
  });

  it("memo recommendation matches policy tier", () => {
    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });

    assert.ok(isSuccess(result));
    assert.equal(result.memo.recommendation, "APPROVE");
  });

  it("empty model returns snapshot failure", () => {
    const result = runFullUnderwrite({
      model: { dealId: "empty", periods: [] },
      product: "SBA",
    });

    assert.ok(isFailure(result));
    assert.equal(result.failedAt, "snapshot");
  });

  it("works without instruments (interest proxy)", () => {
    const result = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
    });

    assert.ok(isSuccess(result), "Pipeline should complete without instruments");
    assert.equal(result.snapshot.debtService.diagnostics.source, "income.interest");
  });

  it("works with all product types", () => {
    const products = ["SBA", "LOC", "EQUIPMENT", "ACQUISITION", "CRE"] as const;

    for (const product of products) {
      const result = runFullUnderwrite({
        model: STRONG_MODEL,
        product,
        instruments: INSTRUMENTS,
      });

      assert.ok(isSuccess(result), `Pipeline should complete for ${product}`);
      assert.equal(result.memo.product, product);
    }
  });

  it("is deterministic — same inputs produce same tier and rate", () => {
    const r1 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });
    const r2 = runFullUnderwrite({
      model: STRONG_MODEL,
      product: "SBA",
      instruments: INSTRUMENTS,
    });

    assert.ok(isSuccess(r1) && isSuccess(r2));
    assert.equal(r1.policy.tier, r2.policy.tier);
    assert.equal(r1.pricing.finalRate, r2.pricing.finalRate);
    assert.equal(r1.stress.worstTier, r2.stress.worstTier);
    assert.equal(r1.memo.recommendation, r2.memo.recommendation);
  });
});
