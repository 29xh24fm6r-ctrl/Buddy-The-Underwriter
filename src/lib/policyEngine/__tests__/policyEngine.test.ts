/**
 * Policy Engine — Phase 5 Tests
 *
 * ~14 tests covering policy evaluation, tier assignment,
 * breach classification, and composed decisions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { FinancialModel } from "@/lib/modelEngine/types";
import { computeCreditSnapshot } from "@/lib/creditMetrics";
import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import { evaluatePolicy } from "../evaluator";
import { computePolicyDecision } from "../index";
import { getPolicyDefinition, MINOR_BREACH_BAND } from "../policies";

// ---------------------------------------------------------------------------
// Test Fixtures — FinancialModels → CreditSnapshots
// ---------------------------------------------------------------------------

// Strong borrower: DSCR ~3.33, leverage 1.5, current ratio 2.9
const STRONG_MODEL: FinancialModel = {
  dealId: "deal-strong",
  periods: [
    {
      periodId: "p-strong",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: {
        revenue: 1_000_000,
        interest: 120_000,
        netIncome: 230_000,
      },
      balance: {
        cash: 150_000,
        accountsReceivable: 80_000,
        inventory: 60_000,
        shortTermDebt: 100_000,
        longTermDebt: 500_000,
      },
      cashflow: { ebitda: 400_000 },
      qualityFlags: [],
    },
  ],
};

// Marginal borrower: DSCR ~1.18, leverage 6.0, current ratio 0.6
const MARGINAL_MODEL: FinancialModel = {
  dealId: "deal-marginal",
  periods: [
    {
      periodId: "p-marginal",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: {
        revenue: 500_000,
        interest: 85_000,
        netIncome: 15_000,
      },
      balance: {
        cash: 20_000,
        accountsReceivable: 10_000,
        inventory: 0,
        shortTermDebt: 50_000,
        longTermDebt: 550_000,
      },
      cashflow: { ebitda: 100_000 },
      qualityFlags: [],
    },
  ],
};

// Weak borrower: DSCR ~0.5, high leverage
const WEAK_MODEL: FinancialModel = {
  dealId: "deal-weak",
  periods: [
    {
      periodId: "p-weak",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: {
        revenue: 300_000,
        interest: 200_000,
        netIncome: -50_000,
      },
      balance: {
        cash: 10_000,
        accountsReceivable: 5_000,
        inventory: 0,
        shortTermDebt: 100_000,
        longTermDebt: 900_000,
      },
      cashflow: { ebitda: 100_000 },
      qualityFlags: [],
    },
  ],
};

// Missing data: no interest, no balance
const MISSING_DATA_MODEL: FinancialModel = {
  dealId: "deal-missing",
  periods: [
    {
      periodId: "p-missing",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 500_000, netIncome: 100_000 },
      balance: {},
      cashflow: { ebitda: 200_000 },
      qualityFlags: [],
    },
  ],
};

// Build snapshots
const STRONG = computeCreditSnapshot(STRONG_MODEL, { strategy: "LATEST_FY" })!;
const MARGINAL = computeCreditSnapshot(MARGINAL_MODEL, { strategy: "LATEST_FY" })!;
const WEAK = computeCreditSnapshot(WEAK_MODEL, { strategy: "LATEST_FY" })!;
const MISSING = computeCreditSnapshot(MISSING_DATA_MODEL, { strategy: "LATEST_FY" })!;

// ---------------------------------------------------------------------------
// SBA Policy Tests (3)
// ---------------------------------------------------------------------------

describe("SBA Policy", () => {
  it("strong borrower passes SBA policy → tier A", () => {
    const result = evaluatePolicy(STRONG, "SBA");
    assert.equal(result.product, "SBA");
    assert.equal(result.passed, true);
    assert.equal(result.failedMetrics.length, 0);
    assert.equal(result.tier, "A");
    // DSCR and leverage should be evaluated
    assert.ok(result.metricsEvaluated.dscr !== undefined);
    assert.ok(result.metricsEvaluated.leverage !== undefined);
  });

  it("marginal DSCR (1.18 < 1.25 min) fails SBA → minor breach", () => {
    const result = evaluatePolicy(MARGINAL, "SBA");
    assert.equal(result.passed, false);
    assert.ok(result.failedMetrics.includes("dscr"));
    // 1.18 vs 1.25 → deviation ~5.6% → minor (within 15% band)
    const dscrBreach = result.breaches.find((b) => b.metric === "dscr");
    assert.ok(dscrBreach);
    assert.equal(dscrBreach!.severity, "minor");
    // Leverage 6.0 > max 4.0 → deviation 50% → severe
    const levBreach = result.breaches.find((b) => b.metric === "leverage");
    assert.ok(levBreach);
    assert.equal(levBreach!.severity, "severe");
  });

  it("weak DSCR (0.5 < 1.25) fails SBA → severe breach", () => {
    const result = evaluatePolicy(WEAK, "SBA");
    assert.equal(result.passed, false);
    const dscrBreach = result.breaches.find((b) => b.metric === "dscr");
    assert.ok(dscrBreach);
    assert.equal(dscrBreach!.severity, "severe");
    // 0.5 vs 1.25 → deviation 60% → severe
    assert.ok(dscrBreach!.deviation > MINOR_BREACH_BAND);
  });
});

// ---------------------------------------------------------------------------
// LOC Policy Tests (2)
// ---------------------------------------------------------------------------

describe("LOC Policy", () => {
  it("strong current ratio passes LOC → tier A", () => {
    const result = evaluatePolicy(STRONG, "LOC");
    assert.equal(result.passed, true);
    assert.equal(result.tier, "A");
    assert.ok(result.metricsEvaluated.currentRatio !== undefined);
    // 2.9 > 1.0 minimum → pass
  });

  it("marginal current ratio (0.6 < 1.0) fails LOC", () => {
    const result = evaluatePolicy(MARGINAL, "LOC");
    assert.equal(result.passed, false);
    assert.ok(result.failedMetrics.includes("currentRatio"));
    const crBreach = result.breaches.find((b) => b.metric === "currentRatio");
    assert.ok(crBreach);
    // 0.6 vs 1.0 → deviation 40% → severe
    assert.equal(crBreach!.severity, "severe");
  });
});

// ---------------------------------------------------------------------------
// Acquisition Policy Tests (1)
// ---------------------------------------------------------------------------

describe("Acquisition Policy", () => {
  it("weak borrower fails both leverage and DSCR", () => {
    const result = evaluatePolicy(WEAK, "ACQUISITION");
    assert.equal(result.passed, false);
    // Leverage: (100k + 900k) / 100k = 10 > max 5.0
    assert.ok(result.failedMetrics.includes("leverage"));
    // DSCR: 100k / 200k = 0.5 < min 1.2
    assert.ok(result.failedMetrics.includes("dscr"));
    assert.equal(result.breaches.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Tier Assignment Tests (3)
// ---------------------------------------------------------------------------

describe("Tier Assignment", () => {
  it("0 breaches → tier A", () => {
    const result = evaluatePolicy(STRONG, "SBA");
    assert.equal(result.tier, "A");
  });

  it("1 severe breach → tier C", () => {
    // LOC marginal: currentRatio 0.6 vs 1.0 → 1 severe breach
    const result = evaluatePolicy(MARGINAL, "LOC");
    assert.equal(result.tier, "C");
    assert.equal(result.breaches.length, 1);
    assert.equal(result.breaches[0].severity, "severe");
  });

  it("2+ severe breaches → tier D", () => {
    // Weak on SBA: DSCR severe + leverage severe
    const result = evaluatePolicy(WEAK, "SBA");
    const severeCount = result.breaches.filter((b) => b.severity === "severe").length;
    assert.ok(severeCount >= 2);
    assert.equal(result.tier, "D");
  });
});

// ---------------------------------------------------------------------------
// Missing Data Tests (2)
// ---------------------------------------------------------------------------

describe("Missing Data Handling", () => {
  it("missing metrics → warnings, not failures", () => {
    const result = evaluatePolicy(MISSING, "SBA");
    // DSCR: missing (no interest → no debt service)
    // Leverage: missing (no debt data)
    assert.ok(result.warnings.length > 0);
    // Missing metrics should NOT cause breaches
    assert.equal(result.breaches.length, 0);
    assert.equal(result.passed, true);
    assert.equal(result.tier, "A");
  });

  it("missing metric value recorded as undefined in metricsEvaluated", () => {
    const result = evaluatePolicy(MISSING, "LOC");
    assert.equal(result.metricsEvaluated.currentRatio, undefined);
    assert.ok(result.warnings.some((w) => w.includes("currentRatio")));
  });
});

// ---------------------------------------------------------------------------
// Composed Decision Tests (2)
// ---------------------------------------------------------------------------

describe("Composed Decision: computePolicyDecision", () => {
  it("returns both analysis and policy", () => {
    const decision = computePolicyDecision(STRONG, "SBA");
    // Analysis from Phase 4B lens
    assert.equal(decision.analysis.product, "SBA");
    assert.ok(decision.analysis.strengths.length > 0);
    // Policy from Phase 5
    assert.equal(decision.policy.product, "SBA");
    assert.equal(decision.policy.passed, true);
    assert.equal(decision.policy.tier, "A");
  });

  it("determinism: same input → same output", () => {
    const a = computePolicyDecision(STRONG, "CRE");
    const b = computePolicyDecision(STRONG, "CRE");
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Policy Definition Tests (1)
// ---------------------------------------------------------------------------

describe("Policy Definitions", () => {
  it("all 5 products have policy definitions with thresholds", () => {
    const products = ["SBA", "LOC", "EQUIPMENT", "ACQUISITION", "CRE"] as const;
    for (const product of products) {
      const policy = getPolicyDefinition(product);
      assert.equal(policy.product, product);
      assert.ok(policy.thresholds.length > 0, `${product} should have thresholds`);
      for (const t of policy.thresholds) {
        assert.ok(t.metric, `${product} threshold should have metric`);
        assert.ok(
          t.minimum !== undefined || t.maximum !== undefined,
          `${product} ${t.metric} should have min or max`,
        );
      }
    }
  });
});
