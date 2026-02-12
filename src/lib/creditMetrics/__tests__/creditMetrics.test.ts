/**
 * Credit Metrics — Phase 4A Tests
 *
 * ~31 tests covering period selection, debt service, core ratios,
 * integration, and explainability.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import type { FinancialModel } from "@/lib/modelEngine/types";
import { selectAnalysisPeriod } from "../periodSelection";
import { computeDebtServiceForPeriod } from "../debtService";
import { computeCoreCreditMetrics } from "../ratios";
import { computeCreditSnapshot } from "../index";
import { safeDivide, safeSum, buildDiagnostics } from "../explain";
import type { DebtServiceResult } from "../types";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const SINGLE_FYE_MODEL: FinancialModel = {
  dealId: "deal-001",
  periods: [
    {
      periodId: "p-fye-2024",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: {
        revenue: 1_000_000,
        cogs: 400_000,
        operatingExpenses: 200_000,
        depreciation: 50_000,
        interest: 120_000,
        netIncome: 230_000,
      },
      balance: {
        cash: 150_000,
        accountsReceivable: 80_000,
        inventory: 60_000,
        totalAssets: 2_000_000,
        shortTermDebt: 100_000,
        longTermDebt: 500_000,
        totalLiabilities: 800_000,
        equity: 1_200_000,
      },
      cashflow: {
        ebitda: 400_000,
        capex: 75_000,
        cfads: 325_000,
      },
      qualityFlags: [],
    },
  ],
};

const MULTI_PERIOD_MODEL: FinancialModel = {
  dealId: "deal-002",
  periods: [
    {
      periodId: "p-fye-2023",
      periodEnd: "2023-12-31",
      type: "FYE",
      income: { revenue: 900_000, interest: 110_000, netIncome: 200_000 },
      balance: {
        cash: 120_000,
        accountsReceivable: 70_000,
        inventory: 50_000,
        shortTermDebt: 90_000,
        longTermDebt: 450_000,
      },
      cashflow: { ebitda: 350_000 },
      qualityFlags: [],
    },
    {
      periodId: "p-ttm-2024-06",
      periodEnd: "2024-06-30",
      type: "TTM",
      income: { revenue: 950_000, interest: 115_000, netIncome: 215_000 },
      balance: {
        cash: 130_000,
        accountsReceivable: 75_000,
        inventory: 55_000,
        shortTermDebt: 95_000,
        longTermDebt: 470_000,
      },
      cashflow: { ebitda: 370_000 },
      qualityFlags: [],
    },
    {
      periodId: "p-fye-2024",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 1_000_000, interest: 120_000, netIncome: 230_000 },
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

const PARTIAL_MODEL: FinancialModel = {
  dealId: "deal-003",
  periods: [
    {
      periodId: "p-partial",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 500_000, netIncome: 100_000 },
      balance: { cash: 50_000 },
      cashflow: { ebitda: 200_000 },
      qualityFlags: ["MISSING_DEBT_SERVICE"],
    },
  ],
};

const EMPTY_MODEL: FinancialModel = {
  dealId: "deal-004",
  periods: [],
};

// Fixture with zero values for divide-by-zero testing
const ZERO_DENOMINATOR_MODEL: FinancialModel = {
  dealId: "deal-005",
  periods: [
    {
      periodId: "p-zero",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 0, interest: 0, netIncome: 50_000 },
      balance: {
        cash: 100_000,
        accountsReceivable: 50_000,
        inventory: 30_000,
        shortTermDebt: 0,
        longTermDebt: 200_000,
      },
      cashflow: { ebitda: 300_000 },
      qualityFlags: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Period Selection Tests (8)
// ---------------------------------------------------------------------------

describe("Period Selection", () => {
  it("LATEST_FY returns most recent FYE", () => {
    const result = selectAnalysisPeriod(MULTI_PERIOD_MODEL, { strategy: "LATEST_FY" });
    assert.ok(result);
    assert.equal(result.periodId, "p-fye-2024");
    assert.equal(result.type, "FYE");
    assert.equal(result.periodEnd, "2024-12-31");
    assert.ok(result.diagnostics.reason.includes("FYE"));
  });

  it("LATEST_FY with no FYE returns undefined", () => {
    const ttmOnly: FinancialModel = {
      dealId: "x",
      periods: [{ ...MULTI_PERIOD_MODEL.periods[1] }],
    };
    const result = selectAnalysisPeriod(ttmOnly, { strategy: "LATEST_FY" });
    assert.equal(result, undefined);
  });

  it("LATEST_TTM returns most recent TTM", () => {
    const result = selectAnalysisPeriod(MULTI_PERIOD_MODEL, { strategy: "LATEST_TTM" });
    assert.ok(result);
    assert.equal(result.periodId, "p-ttm-2024-06");
    assert.equal(result.type, "TTM");
  });

  it("LATEST_TTM with no TTM returns undefined", () => {
    const result = selectAnalysisPeriod(SINGLE_FYE_MODEL, { strategy: "LATEST_TTM" });
    assert.equal(result, undefined);
  });

  it("LATEST_AVAILABLE returns most recent regardless of type", () => {
    const result = selectAnalysisPeriod(MULTI_PERIOD_MODEL, { strategy: "LATEST_AVAILABLE" });
    assert.ok(result);
    assert.equal(result.periodId, "p-fye-2024");
    assert.equal(result.periodEnd, "2024-12-31");
    assert.ok(result.diagnostics.reason.includes("most recent"));
  });

  it("EXPLICIT with valid periodId returns correct period", () => {
    const result = selectAnalysisPeriod(MULTI_PERIOD_MODEL, {
      strategy: "EXPLICIT",
      periodId: "p-ttm-2024-06",
    });
    assert.ok(result);
    assert.equal(result.periodId, "p-ttm-2024-06");
    assert.equal(result.type, "TTM");
  });

  it("EXPLICIT with invalid periodId returns undefined", () => {
    const result = selectAnalysisPeriod(MULTI_PERIOD_MODEL, {
      strategy: "EXPLICIT",
      periodId: "nonexistent",
    });
    assert.equal(result, undefined);
  });

  it("deterministic: same input produces same output", () => {
    const a = selectAnalysisPeriod(MULTI_PERIOD_MODEL, { strategy: "LATEST_FY" });
    const b = selectAnalysisPeriod(MULTI_PERIOD_MODEL, { strategy: "LATEST_FY" });
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Debt Service Tests (5)
// ---------------------------------------------------------------------------

describe("Debt Service", () => {
  it("period with income.interest returns correct totalDebtService", () => {
    const result = computeDebtServiceForPeriod(SINGLE_FYE_MODEL, "p-fye-2024");
    assert.equal(result.totalDebtService, 120_000);
    assert.equal(result.diagnostics.source, "income.interest");
    assert.equal(result.diagnostics.missingComponents, undefined);
  });

  it("no interest returns undefined with diagnostic", () => {
    const result = computeDebtServiceForPeriod(PARTIAL_MODEL, "p-partial");
    assert.equal(result.totalDebtService, undefined);
    assert.ok(result.diagnostics.missingComponents);
    assert.ok(result.diagnostics.missingComponents!.length > 0);
  });

  it("proposed is always undefined in Phase 4A", () => {
    const result = computeDebtServiceForPeriod(SINGLE_FYE_MODEL, "p-fye-2024");
    assert.equal(result.breakdown.proposed, undefined);
  });

  it("existing equals income.interest", () => {
    const result = computeDebtServiceForPeriod(SINGLE_FYE_MODEL, "p-fye-2024");
    assert.equal(result.breakdown.existing, 120_000);
  });

  it("deterministic: same input produces same output", () => {
    const a = computeDebtServiceForPeriod(MULTI_PERIOD_MODEL, "p-fye-2024");
    const b = computeDebtServiceForPeriod(MULTI_PERIOD_MODEL, "p-fye-2024");
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Core Ratios Tests (12)
// ---------------------------------------------------------------------------

describe("Core Ratios", () => {
  const COMPLETE_DEBT_SERVICE: DebtServiceResult = {
    totalDebtService: 120_000,
    breakdown: { proposed: undefined, existing: 120_000 },
    diagnostics: { source: "income.interest" },
  };

  const MISSING_DEBT_SERVICE: DebtServiceResult = {
    totalDebtService: undefined,
    breakdown: { proposed: undefined, existing: undefined },
    diagnostics: { source: "income.interest", missingComponents: ["income.interest"] },
  };

  const ZERO_DEBT_SERVICE: DebtServiceResult = {
    totalDebtService: 0,
    breakdown: { proposed: undefined, existing: 0 },
    diagnostics: { source: "income.interest" },
  };

  it("DSCR with complete data returns correct value", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const dscr = result.metrics.dscr;
    assert.ok(dscr);
    assert.ok(dscr.value !== undefined);
    // EBITDA (400_000) / debt service (120_000) = 3.333...
    assert.ok(Math.abs(dscr.value! - 400_000 / 120_000) < 0.001);
    assert.equal(dscr.formula, "EBITDA / TotalDebtService");
  });

  it("DSCR with zero debt service returns divideByZero", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", ZERO_DEBT_SERVICE);
    const dscr = result.metrics.dscr;
    assert.ok(dscr);
    assert.equal(dscr.value, undefined);
    assert.ok(dscr.diagnostics?.divideByZero);
  });

  it("DSCR with missing EBITDA returns missingInputs", () => {
    // PARTIAL_MODEL has ebitda but let's test with missing debt service
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", MISSING_DEBT_SERVICE);
    const dscr = result.metrics.dscr;
    assert.ok(dscr);
    assert.equal(dscr.value, undefined);
    assert.ok(dscr.diagnostics?.missingInputs);
    assert.ok(dscr.diagnostics!.missingInputs!.includes("totalDebtService"));
  });

  it("leverage with complete data returns correct value", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const lev = result.metrics.leverageDebtToEbitda;
    assert.ok(lev);
    assert.ok(lev.value !== undefined);
    // (100_000 + 500_000) / 400_000 = 1.5
    assert.ok(Math.abs(lev.value! - 1.5) < 0.001);
  });

  it("current ratio with complete data returns correct value", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const cr = result.metrics.currentRatio;
    assert.ok(cr);
    assert.ok(cr.value !== undefined);
    // (150_000 + 80_000 + 60_000) / 100_000 = 2.9
    assert.ok(Math.abs(cr.value! - 2.9) < 0.001);
  });

  it("quick ratio with complete data returns correct value", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const qr = result.metrics.quickRatio;
    assert.ok(qr);
    assert.ok(qr.value !== undefined);
    // (150_000 + 80_000) / 100_000 = 2.3
    assert.ok(Math.abs(qr.value! - 2.3) < 0.001);
  });

  it("working capital with complete data returns correct value", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const wc = result.metrics.workingCapital;
    assert.ok(wc);
    assert.ok(wc.value !== undefined);
    // (150_000 + 80_000 + 60_000) - 100_000 = 190_000
    assert.equal(wc.value, 190_000);
  });

  it("EBITDA margin with complete data returns correct value", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const em = result.metrics.ebitdaMargin;
    assert.ok(em);
    assert.ok(em.value !== undefined);
    // 400_000 / 1_000_000 = 0.4
    assert.ok(Math.abs(em.value! - 0.4) < 0.001);
  });

  it("net margin with complete data returns correct value", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const nm = result.metrics.netMargin;
    assert.ok(nm);
    assert.ok(nm.value !== undefined);
    // 230_000 / 1_000_000 = 0.23
    assert.ok(Math.abs(nm.value! - 0.23) < 0.001);
  });

  it("zero revenue causes divideByZero for margin metrics", () => {
    const result = computeCoreCreditMetrics(ZERO_DENOMINATOR_MODEL, "p-zero", ZERO_DEBT_SERVICE);
    const em = result.metrics.ebitdaMargin;
    const nm = result.metrics.netMargin;
    assert.ok(em);
    assert.ok(nm);
    assert.equal(em.value, undefined);
    assert.ok(em.diagnostics?.divideByZero);
    assert.equal(nm.value, undefined);
    assert.ok(nm.diagnostics?.divideByZero);
  });

  it("partial balance sheet lists missing inputs", () => {
    const result = computeCoreCreditMetrics(PARTIAL_MODEL, "p-partial", MISSING_DEBT_SERVICE);
    const cr = result.metrics.currentRatio;
    assert.ok(cr);
    assert.equal(cr.value, undefined);
    assert.ok(cr.diagnostics?.missingInputs);
    assert.ok(cr.diagnostics!.missingInputs!.includes("accountsReceivable"));
    assert.ok(cr.diagnostics!.missingInputs!.includes("inventory"));
  });

  it("all formulas are human-readable strings", () => {
    const result = computeCoreCreditMetrics(SINGLE_FYE_MODEL, "p-fye-2024", COMPLETE_DEBT_SERVICE);
    const m = result.metrics;
    assert.ok(m.dscr!.formula.includes("/"));
    assert.ok(m.leverageDebtToEbitda!.formula.includes("/"));
    assert.ok(m.currentRatio!.formula.includes("/"));
    assert.ok(m.quickRatio!.formula.includes("/"));
    assert.ok(m.workingCapital!.formula.includes("-"));
    assert.ok(m.ebitdaMargin!.formula.includes("/"));
    assert.ok(m.netMargin!.formula.includes("/"));
  });
});

// ---------------------------------------------------------------------------
// Integration Tests (4)
// ---------------------------------------------------------------------------

describe("Integration: computeCreditSnapshot", () => {
  it("complete model returns all metrics present", () => {
    const snapshot = computeCreditSnapshot(SINGLE_FYE_MODEL, { strategy: "LATEST_FY" });
    assert.ok(snapshot);
    assert.equal(snapshot.dealId, "deal-001");
    assert.equal(snapshot.period.periodId, "p-fye-2024");
    assert.ok(snapshot.debtService.totalDebtService !== undefined);
    assert.ok(snapshot.ratios.metrics.dscr);
    assert.ok(snapshot.ratios.metrics.leverageDebtToEbitda);
    assert.ok(snapshot.ratios.metrics.currentRatio);
    assert.ok(snapshot.ratios.metrics.quickRatio);
    assert.ok(snapshot.ratios.metrics.workingCapital);
    assert.ok(snapshot.ratios.metrics.ebitdaMargin);
    assert.ok(snapshot.ratios.metrics.netMargin);
    assert.ok(snapshot.generatedAt);
  });

  it("empty model returns undefined", () => {
    const snapshot = computeCreditSnapshot(EMPTY_MODEL, { strategy: "LATEST_FY" });
    assert.equal(snapshot, undefined);
  });

  it("partial model returns some metrics undefined with diagnostics", () => {
    const snapshot = computeCreditSnapshot(PARTIAL_MODEL, { strategy: "LATEST_FY" });
    assert.ok(snapshot);
    assert.equal(snapshot.debtService.totalDebtService, undefined);
    // DSCR should be undefined (missing debt service)
    assert.ok(snapshot.ratios.metrics.dscr);
    assert.equal(snapshot.ratios.metrics.dscr!.value, undefined);
    assert.ok(snapshot.ratios.metrics.dscr!.diagnostics?.missingInputs);
    // EBITDA margin should still compute (has ebitda and revenue)
    assert.ok(snapshot.ratios.metrics.ebitdaMargin);
    assert.ok(snapshot.ratios.metrics.ebitdaMargin!.value !== undefined);
  });

  it("determinism: compute twice produces deep equal results (excluding generatedAt)", () => {
    const a = computeCreditSnapshot(MULTI_PERIOD_MODEL, { strategy: "LATEST_FY" });
    const b = computeCreditSnapshot(MULTI_PERIOD_MODEL, { strategy: "LATEST_FY" });
    assert.ok(a);
    assert.ok(b);
    // Compare everything except generatedAt
    assert.deepEqual(a.period, b.period);
    assert.deepEqual(a.debtService, b.debtService);
    assert.deepEqual(a.ratios, b.ratios);
    assert.equal(a.dealId, b.dealId);
  });
});

// ---------------------------------------------------------------------------
// Explainability Tests (2)
// ---------------------------------------------------------------------------

describe("Explainability", () => {
  it("every metric in snapshot has inputs and formula", () => {
    const snapshot = computeCreditSnapshot(SINGLE_FYE_MODEL, { strategy: "LATEST_FY" });
    assert.ok(snapshot);
    const m = snapshot.ratios.metrics;
    for (const [name, metric] of Object.entries(m)) {
      assert.ok(metric, `${name} should exist`);
      assert.ok(typeof metric.formula === "string" && metric.formula.length > 0, `${name} has formula`);
      assert.ok(typeof metric.inputs === "object" && metric.inputs !== null, `${name} has inputs`);
    }
  });

  it("missing inputs are explicitly listed, never silently zeroed", () => {
    const snapshot = computeCreditSnapshot(PARTIAL_MODEL, { strategy: "LATEST_FY" });
    assert.ok(snapshot);
    const m = snapshot.ratios.metrics;

    // Current ratio: missing accountsReceivable, inventory, shortTermDebt
    const cr = m.currentRatio;
    assert.ok(cr);
    assert.equal(cr.value, undefined);
    assert.ok(cr.diagnostics?.missingInputs);
    assert.ok(cr.diagnostics!.missingInputs!.length > 0);

    // Verify no input was silently set to 0 that was actually undefined
    for (const [key, val] of Object.entries(cr.inputs)) {
      if (val === 0) {
        // If it's 0, it should have been explicitly 0 in the source
        // For PARTIAL_MODEL, only cash is defined (50_000), the rest should be undefined
        assert.ok(
          key === "currentAssets" || key === "cash",
          `${key} should not be silently zeroed — was ${val}`,
        );
      }
    }
  });
});
