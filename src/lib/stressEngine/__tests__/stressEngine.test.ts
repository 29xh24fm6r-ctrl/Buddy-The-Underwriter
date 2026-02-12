/**
 * Stress Engine — Tests
 *
 * Tests model transforms, scenario execution, and aggregate stress analysis.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import type { CreditSnapshotOpts } from "@/lib/creditMetrics/types";
import { applyEbitdaHaircut, applyRevenueHaircut, applyRateShock } from "../modelTransforms";
import { STRESS_SCENARIOS, getScenarioDefinition } from "../scenarios";
import { runScenario } from "../runner";
import { runStressScenarios, compareTiers } from "../index";

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

/** Marginal borrower — DSCR near threshold without instruments */
const MARGINAL_MODEL: FinancialModel = {
  dealId: "test-marginal",
  periods: [
    {
      periodId: "fy-2024",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: {
        revenue: 500_000,
        cogs: 200_000,
        operatingExpenses: 150_000,
        depreciation: 20_000,
        interest: 50_000,
        netIncome: 80_000,
      },
      balance: {
        cash: 30_000,
        accountsReceivable: 20_000,
        inventory: 10_000,
        totalAssets: 600_000,
        shortTermDebt: 100_000,
        longTermDebt: 300_000,
        totalLiabilities: 450_000,
        equity: 150_000,
      },
      cashflow: {
        ebitda: 120_000,
        capex: 10_000,
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

const DEFAULT_OPTS: CreditSnapshotOpts = {
  strategy: "LATEST_AVAILABLE",
  instruments: INSTRUMENTS,
};

// ---------------------------------------------------------------------------
// Model Transform Tests
// ---------------------------------------------------------------------------

describe("Model Transforms", () => {
  describe("applyEbitdaHaircut", () => {
    it("reduces EBITDA by specified percentage", () => {
      const result = applyEbitdaHaircut(STRONG_MODEL, 0.10);
      const period = result.periods[0];
      assert.equal(period.cashflow.ebitda, 360_000); // 400K * 0.90
    });

    it("does not mutate original model", () => {
      const original = STRONG_MODEL.periods[0].cashflow.ebitda;
      applyEbitdaHaircut(STRONG_MODEL, 0.10);
      assert.equal(STRONG_MODEL.periods[0].cashflow.ebitda, original);
    });

    it("leaves undefined EBITDA as undefined", () => {
      const model: FinancialModel = {
        dealId: "test",
        periods: [
          {
            periodId: "fy",
            periodEnd: "2024-12-31",
            type: "FYE",
            income: {},
            balance: {},
            cashflow: {},
            qualityFlags: [],
          },
        ],
      };
      const result = applyEbitdaHaircut(model, 0.10);
      assert.equal(result.periods[0].cashflow.ebitda, undefined);
    });

    it("does not affect revenue", () => {
      const result = applyEbitdaHaircut(STRONG_MODEL, 0.10);
      assert.equal(result.periods[0].income.revenue, 1_000_000);
    });
  });

  describe("applyRevenueHaircut", () => {
    it("reduces revenue by specified percentage", () => {
      const result = applyRevenueHaircut(STRONG_MODEL, 0.10);
      assert.equal(result.periods[0].income.revenue, 900_000); // 1M * 0.90
    });

    it("does not affect EBITDA", () => {
      const result = applyRevenueHaircut(STRONG_MODEL, 0.10);
      assert.equal(result.periods[0].cashflow.ebitda, 400_000); // unchanged
    });

    it("does not mutate original model", () => {
      const original = STRONG_MODEL.periods[0].income.revenue;
      applyRevenueHaircut(STRONG_MODEL, 0.10);
      assert.equal(STRONG_MODEL.periods[0].income.revenue, original);
    });
  });

  describe("applyRateShock", () => {
    it("increases rate by specified basis points", () => {
      const result = applyRateShock(INSTRUMENTS, 200);
      assert.ok(result);
      assert.equal(result.length, 1);
      assert.equal(result[0].rate, 0.085); // 0.065 + 0.02
    });

    it("returns undefined for undefined instruments", () => {
      const result = applyRateShock(undefined, 200);
      assert.equal(result, undefined);
    });

    it("returns undefined for empty instruments", () => {
      const result = applyRateShock([], 200);
      assert.equal(result, undefined);
    });

    it("does not mutate original instruments", () => {
      const original = INSTRUMENTS[0].rate;
      applyRateShock(INSTRUMENTS, 200);
      assert.equal(INSTRUMENTS[0].rate, original);
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario Tests
// ---------------------------------------------------------------------------

describe("Scenarios", () => {
  it("has 5 scenarios", () => {
    assert.equal(STRESS_SCENARIOS.length, 5);
  });

  it("first scenario is BASELINE", () => {
    assert.equal(STRESS_SCENARIOS[0].key, "BASELINE");
  });

  it("getScenarioDefinition returns correct scenario", () => {
    const scenario = getScenarioDefinition("EBITDA_10_DOWN");
    assert.equal(scenario.ebitdaHaircut, 0.10);
  });

  it("COMBINED_MODERATE has both EBITDA haircut and rate shock", () => {
    const scenario = getScenarioDefinition("COMBINED_MODERATE");
    assert.equal(scenario.ebitdaHaircut, 0.10);
    assert.equal(scenario.rateShockBps, 200);
  });
});

// ---------------------------------------------------------------------------
// Runner Tests
// ---------------------------------------------------------------------------

describe("runScenario", () => {
  it("BASELINE produces valid snapshot and policy", () => {
    const baseline = runScenario(
      STRESS_SCENARIOS[0],
      STRONG_MODEL,
      INSTRUMENTS,
      DEFAULT_OPTS,
      "SBA",
    );
    assert.ok(baseline);
    assert.equal(baseline.key, "BASELINE");
    assert.ok(baseline.snapshot.ratios.metrics.dscr?.value);
    assert.equal(baseline.dscrDelta, undefined); // No baseline to compare
  });

  it("EBITDA haircut lowers DSCR vs baseline", () => {
    const baseline = runScenario(
      STRESS_SCENARIOS[0], STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA",
    );
    assert.ok(baseline);

    const stressed = runScenario(
      getScenarioDefinition("EBITDA_10_DOWN"),
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA", baseline,
    );
    assert.ok(stressed);
    assert.ok(stressed.dscrDelta !== undefined);
    assert.ok(stressed.dscrDelta < 0, "DSCR should decrease under EBITDA stress");
  });

  it("rate shock increases debt service", () => {
    const baseline = runScenario(
      STRESS_SCENARIOS[0], STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA",
    );
    assert.ok(baseline);

    const stressed = runScenario(
      getScenarioDefinition("RATE_PLUS_200"),
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA", baseline,
    );
    assert.ok(stressed);
    assert.ok(stressed.debtServiceDelta !== undefined);
    assert.ok(stressed.debtServiceDelta > 0, "Debt service should increase under rate shock");
    assert.ok(stressed.dscrDelta! < 0, "DSCR should decrease under rate shock");
  });

  it("revenue haircut does NOT affect DSCR when EBITDA is separate", () => {
    const baseline = runScenario(
      STRESS_SCENARIOS[0], STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA",
    );
    assert.ok(baseline);

    const stressed = runScenario(
      getScenarioDefinition("REVENUE_10_DOWN"),
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA", baseline,
    );
    assert.ok(stressed);
    // DSCR delta should be 0 because EBITDA is unchanged
    assert.equal(stressed.dscrDelta, 0, "Revenue haircut should not affect DSCR");
  });

  it("combined stress is worse than EBITDA-only", () => {
    const baseline = runScenario(
      STRESS_SCENARIOS[0], STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA",
    );
    assert.ok(baseline);

    const ebitdaOnly = runScenario(
      getScenarioDefinition("EBITDA_10_DOWN"),
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA", baseline,
    );
    assert.ok(ebitdaOnly);

    const combined = runScenario(
      getScenarioDefinition("COMBINED_MODERATE"),
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, "SBA", baseline,
    );
    assert.ok(combined);

    assert.ok(
      combined.dscrDelta! < ebitdaOnly.dscrDelta!,
      "Combined stress should produce worse DSCR than EBITDA-only",
    );
  });

  it("returns undefined when model has no periods", () => {
    const emptyModel: FinancialModel = { dealId: "empty", periods: [] };
    const result = runScenario(
      STRESS_SCENARIOS[0], emptyModel, INSTRUMENTS, DEFAULT_OPTS, "SBA",
    );
    assert.equal(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// Full Stress Run Tests
// ---------------------------------------------------------------------------

describe("runStressScenarios", () => {
  it("strong borrower stays tier A under all stress", () => {
    const result = runStressScenarios(
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, { product: "SBA" },
    );
    assert.ok(result);
    assert.equal(result.baseline.policy.tier, "A");
    assert.equal(result.worstTier, "A");
    assert.equal(result.tierDegraded, false);
  });

  it("returns all 5 scenarios", () => {
    const result = runStressScenarios(
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, { product: "SBA" },
    );
    assert.ok(result);
    assert.equal(result.scenarios.length, 5);
  });

  it("returns undefined for empty model", () => {
    const emptyModel: FinancialModel = { dealId: "empty", periods: [] };
    const result = runStressScenarios(
      emptyModel, INSTRUMENTS, DEFAULT_OPTS, { product: "SBA" },
    );
    assert.equal(result, undefined);
  });

  it("works without instruments (interest proxy fallback)", () => {
    const noInstrumentsOpts: CreditSnapshotOpts = {
      strategy: "LATEST_AVAILABLE",
    };
    const result = runStressScenarios(
      STRONG_MODEL, undefined, noInstrumentsOpts, { product: "SBA" },
    );
    assert.ok(result);
    // Rate shock scenario should have same debt service as baseline (no instruments to shock)
    const rateScenario = result.scenarios.find((s) => s.key === "RATE_PLUS_200");
    assert.ok(rateScenario);
    assert.equal(rateScenario.debtServiceDelta, 0);
  });

  it("is deterministic — same inputs produce same outputs", () => {
    const r1 = runStressScenarios(
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, { product: "SBA" },
    );
    const r2 = runStressScenarios(
      STRONG_MODEL, INSTRUMENTS, DEFAULT_OPTS, { product: "SBA" },
    );
    assert.ok(r1 && r2);
    assert.equal(r1.worstTier, r2.worstTier);
    assert.equal(r1.tierDegraded, r2.tierDegraded);
    assert.equal(r1.scenarios.length, r2.scenarios.length);
    for (let i = 0; i < r1.scenarios.length; i++) {
      assert.equal(r1.scenarios[i].policy.tier, r2.scenarios[i].policy.tier);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier Comparison Tests
// ---------------------------------------------------------------------------

describe("compareTiers", () => {
  it("A < B < C < D", () => {
    assert.ok(compareTiers("A", "B") < 0);
    assert.ok(compareTiers("B", "C") < 0);
    assert.ok(compareTiers("C", "D") < 0);
  });

  it("same tier returns 0", () => {
    assert.equal(compareTiers("A", "A"), 0);
    assert.equal(compareTiers("D", "D"), 0);
  });

  it("D > A", () => {
    assert.ok(compareTiers("D", "A") > 0);
  });
});
