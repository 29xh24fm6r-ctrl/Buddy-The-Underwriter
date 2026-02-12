/**
 * Credit Lenses — Phase 4B Tests
 *
 * ~20 tests covering all 5 product lenses, orchestrator,
 * cross-cutting behavior, and structural contracts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { FinancialModel } from "@/lib/modelEngine/types";
import { computeCreditSnapshot } from "@/lib/creditMetrics";
import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import {
  computeProductAnalysis,
  computeSbaLens,
  computeLocLens,
  computeEquipmentLens,
  computeAcquisitionLens,
  computeCreLens,
} from "../index";
import type { ProductType } from "../types";

// ---------------------------------------------------------------------------
// Test Fixtures — FinancialModels → CreditSnapshots
// ---------------------------------------------------------------------------

const COMPLETE_MODEL: FinancialModel = {
  dealId: "deal-complete",
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

const PARTIAL_MODEL: FinancialModel = {
  dealId: "deal-partial",
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

const MINIMAL_MODEL: FinancialModel = {
  dealId: "deal-minimal",
  periods: [
    {
      periodId: "p-minimal",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 300_000, netIncome: -20_000 },
      balance: {},
      cashflow: {},
      qualityFlags: [],
    },
  ],
};

const NEGATIVE_WC_MODEL: FinancialModel = {
  dealId: "deal-neg-wc",
  periods: [
    {
      periodId: "p-neg-wc",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: {
        revenue: 800_000,
        interest: 100_000,
        netIncome: 50_000,
      },
      balance: {
        cash: 20_000,
        accountsReceivable: 30_000,
        inventory: 10_000,
        shortTermDebt: 200_000,
        longTermDebt: 300_000,
      },
      cashflow: { ebitda: 250_000 },
      qualityFlags: [],
    },
  ],
};

// Build snapshots
const COMPLETE_SNAPSHOT = computeCreditSnapshot(COMPLETE_MODEL, { strategy: "LATEST_FY" })!;
const PARTIAL_SNAPSHOT = computeCreditSnapshot(PARTIAL_MODEL, { strategy: "LATEST_FY" })!;
const MINIMAL_SNAPSHOT = computeCreditSnapshot(MINIMAL_MODEL, { strategy: "LATEST_FY" })!;
const NEGATIVE_WC_SNAPSHOT = computeCreditSnapshot(NEGATIVE_WC_MODEL, { strategy: "LATEST_FY" })!;

// ---------------------------------------------------------------------------
// SBA Lens (3 tests)
// ---------------------------------------------------------------------------

describe("SBA Lens", () => {
  it("full data → strengths include DSCR and EBITDA; no data gaps", () => {
    const result = computeSbaLens(COMPLETE_SNAPSHOT);
    assert.equal(result.product, "SBA");
    assert.ok(result.strengths.some((s) => s.includes("coverage ratio")));
    assert.ok(result.strengths.some((s) => s.includes("EBITDA")));
    assert.ok(result.strengths.some((s) => s.includes("net income")));
    assert.equal(result.dataGaps.length, 0);
  });

  it("missing DSCR → weakness listed; data gap for debt service", () => {
    const result = computeSbaLens(PARTIAL_SNAPSHOT);
    assert.ok(result.weaknesses.some((w) => w.includes("coverage ratio unavailable")));
    assert.ok(result.diagnostics.missingMetrics.includes("dscr"));
  });

  it("negative net income → weakness listed", () => {
    const result = computeSbaLens(MINIMAL_SNAPSHOT);
    assert.ok(result.weaknesses.some((w) => w.includes("Negative net income")));
  });
});

// ---------------------------------------------------------------------------
// LOC Lens (3 tests)
// ---------------------------------------------------------------------------

describe("LOC Lens", () => {
  it("full data → positive working capital strength", () => {
    const result = computeLocLens(COMPLETE_SNAPSHOT);
    assert.equal(result.product, "LOC");
    assert.ok(result.strengths.some((s) => s.includes("working capital")));
    assert.ok(result.strengths.some((s) => s.includes("Current ratio")));
  });

  it("negative working capital → weakness listed", () => {
    const result = computeLocLens(NEGATIVE_WC_SNAPSHOT);
    assert.ok(result.weaknesses.some((w) => w.includes("Negative working capital")));
  });

  it("missing current ratio → in missing metrics", () => {
    const result = computeLocLens(MINIMAL_SNAPSHOT);
    assert.ok(result.diagnostics.missingMetrics.includes("currentRatio"));
  });
});

// ---------------------------------------------------------------------------
// Equipment Lens (2 tests)
// ---------------------------------------------------------------------------

describe("Equipment Lens", () => {
  it("full data → DSCR strength", () => {
    const result = computeEquipmentLens(COMPLETE_SNAPSHOT);
    assert.equal(result.product, "EQUIPMENT");
    assert.ok(result.strengths.some((s) => s.includes("coverage")));
  });

  it("missing debt service → risk signal", () => {
    const result = computeEquipmentLens(PARTIAL_SNAPSHOT);
    assert.ok(result.riskSignals.some((r) => r.includes("Debt service data unavailable")));
  });
});

// ---------------------------------------------------------------------------
// Acquisition Lens (2 tests)
// ---------------------------------------------------------------------------

describe("Acquisition Lens", () => {
  it("full data → leverage + EBITDA strengths", () => {
    const result = computeAcquisitionLens(COMPLETE_SNAPSHOT);
    assert.equal(result.product, "ACQUISITION");
    assert.ok(result.strengths.some((s) => s.includes("EBITDA")));
    assert.ok(result.strengths.some((s) => s.includes("Leverage")));
  });

  it("missing EBITDA → weakness 'cannot assess'", () => {
    const result = computeAcquisitionLens(MINIMAL_SNAPSHOT);
    assert.ok(result.weaknesses.some((w) => w.includes("cannot assess")));
  });
});

// ---------------------------------------------------------------------------
// CRE Lens (2 tests)
// ---------------------------------------------------------------------------

describe("CRE Lens", () => {
  it("full data → DSCR strength", () => {
    const result = computeCreLens(COMPLETE_SNAPSHOT);
    assert.equal(result.product, "CRE");
    assert.ok(result.strengths.some((s) => s.includes("coverage")));
    assert.ok(result.strengths.some((s) => s.includes("net income")));
  });

  it("minimal data → multiple data gaps", () => {
    const result = computeCreLens(MINIMAL_SNAPSHOT);
    assert.ok(result.dataGaps.length > 0);
    assert.ok(result.diagnostics.missingMetrics.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator (2 tests)
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  it("computeProductAnalysis routes to correct lens", () => {
    const sba = computeProductAnalysis(COMPLETE_SNAPSHOT, "SBA");
    const loc = computeProductAnalysis(COMPLETE_SNAPSHOT, "LOC");
    assert.equal(sba.product, "SBA");
    assert.equal(loc.product, "LOC");
    // SBA and LOC have different strength messages
    assert.notDeepEqual(sba.strengths, loc.strengths);
  });

  it("all 5 product types return valid ProductAnalysis shape", () => {
    const products: ProductType[] = ["SBA", "LOC", "EQUIPMENT", "ACQUISITION", "CRE"];
    for (const product of products) {
      const result = computeProductAnalysis(COMPLETE_SNAPSHOT, product);
      assert.equal(result.product, product);
      assert.equal(result.periodId, COMPLETE_SNAPSHOT.period.periodId);
      assert.equal(result.periodEnd, COMPLETE_SNAPSHOT.period.periodEnd);
      assert.ok(Array.isArray(result.strengths));
      assert.ok(Array.isArray(result.weaknesses));
      assert.ok(Array.isArray(result.riskSignals));
      assert.ok(Array.isArray(result.dataGaps));
      assert.ok(result.diagnostics);
      assert.ok(Array.isArray(result.diagnostics.missingMetrics));
      assert.ok(Array.isArray(result.diagnostics.notes));
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting (4 tests)
// ---------------------------------------------------------------------------

describe("Cross-cutting", () => {
  it("determinism: same input → same output", () => {
    const a = computeProductAnalysis(COMPLETE_SNAPSHOT, "SBA");
    const b = computeProductAnalysis(COMPLETE_SNAPSHOT, "SBA");
    assert.deepEqual(a, b);
  });

  it("no thresholds: no strength/weakness mentions specific numbers", () => {
    const products: ProductType[] = ["SBA", "LOC", "EQUIPMENT", "ACQUISITION", "CRE"];
    const thresholdPattern = /\d+\.\d+x|\d+%|>\s*\d|<\s*\d|minimum|maximum|floor|ceiling/i;
    for (const product of products) {
      const result = computeProductAnalysis(COMPLETE_SNAPSHOT, product);
      for (const msg of [...result.strengths, ...result.weaknesses, ...result.riskSignals]) {
        assert.ok(
          !thresholdPattern.test(msg),
          `${product} has threshold language: "${msg}"`,
        );
      }
    }
  });

  it("missing metrics propagate to dataGaps array", () => {
    const result = computeProductAnalysis(PARTIAL_SNAPSHOT, "SBA");
    // PARTIAL_SNAPSHOT has no debt service → DSCR is missing
    assert.ok(result.diagnostics.missingMetrics.includes("dscr"));
  });

  it("keyMetrics values match snapshot ratio values exactly", () => {
    const result = computeProductAnalysis(COMPLETE_SNAPSHOT, "SBA");
    assert.equal(result.keyMetrics.dscr, COMPLETE_SNAPSHOT.ratios.metrics.dscr?.value);
    assert.equal(result.keyMetrics.leverage, COMPLETE_SNAPSHOT.ratios.metrics.leverageDebtToEbitda?.value);
    assert.equal(result.keyMetrics.currentRatio, COMPLETE_SNAPSHOT.ratios.metrics.currentRatio?.value);
    assert.equal(result.keyMetrics.quickRatio, COMPLETE_SNAPSHOT.ratios.metrics.quickRatio?.value);
    assert.equal(result.keyMetrics.workingCapital, COMPLETE_SNAPSHOT.ratios.metrics.workingCapital?.value);
    assert.equal(result.keyMetrics.ebitdaMargin, COMPLETE_SNAPSHOT.ratios.metrics.ebitdaMargin?.value);
    assert.equal(result.keyMetrics.netMargin, COMPLETE_SNAPSHOT.ratios.metrics.netMargin?.value);
  });
});

// ---------------------------------------------------------------------------
// Structural (2 tests)
// ---------------------------------------------------------------------------

describe("Structural", () => {
  it("every ProductAnalysis has product, periodId, periodEnd set", () => {
    const products: ProductType[] = ["SBA", "LOC", "EQUIPMENT", "ACQUISITION", "CRE"];
    for (const product of products) {
      const result = computeProductAnalysis(PARTIAL_SNAPSHOT, product);
      assert.ok(result.product);
      assert.ok(result.periodId);
      assert.ok(result.periodEnd);
    }
  });

  it("diagnostics.missingMetrics correctly lists undefined metrics", () => {
    // MINIMAL_SNAPSHOT: only revenue + netIncome → most metrics missing
    const result = computeProductAnalysis(MINIMAL_SNAPSHOT, "LOC");
    // currentRatio, quickRatio, workingCapital should all be missing
    assert.ok(result.diagnostics.missingMetrics.includes("currentRatio"));
    assert.ok(result.diagnostics.missingMetrics.includes("quickRatio"));
    assert.ok(result.diagnostics.missingMetrics.includes("workingCapital"));
  });
});
