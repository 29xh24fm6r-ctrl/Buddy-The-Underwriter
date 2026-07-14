import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFinancialViability } from "@/lib/feasibility/financialViabilityAnalysis";
import type { FinancialViabilityInput } from "@/lib/feasibility/types";

const BASE_INPUT: FinancialViabilityInput = {
  dscrYear1Base: null,
  dscrYear2Base: null,
  dscrYear3Base: null,
  dscrYear1Downside: null,
  breakEvenRevenue: null,
  projectedRevenueYear1: null,
  marginOfSafetyPct: null,
  downsideDscrYear1: null,
  equityInjectionPct: null,
  totalProjectCost: null,
  workingCapitalReserveMonths: null,
  globalDscr: null,
  guarantorsWithNegativeCF: [],
  currentRatioYear1: null,
  debtToEquityYear1: null,
  historicalRevenueGrowth: null,
  historicalEBITDAMargin: null,
  isNewBusiness: false,
  equityInjectionFloor: 0.1,
  projectedDscrThreshold: 1.1,
  loanAmount: 500_000,
  loanTermMonths: 120,
};

test("analyzeFinancialViability: DSCR of 1.15x is fine for an established business (threshold 1.10x) but critical for a new business (threshold 1.25x)", () => {
  const existing = analyzeFinancialViability({
    ...BASE_INPUT,
    dscrYear1Base: 1.15,
    isNewBusiness: false,
    projectedDscrThreshold: 1.1,
  });
  assert.equal(
    existing.flags.some((f) => f.dimension === "debtServiceCoverage" && f.severity === "critical"),
    false,
  );

  const startup = analyzeFinancialViability({
    ...BASE_INPUT,
    dscrYear1Base: 1.15,
    isNewBusiness: true,
    projectedDscrThreshold: 1.25,
  });
  assert.equal(
    startup.flags.some((f) => f.dimension === "debtServiceCoverage" && f.severity === "critical"),
    true,
  );
});

test("analyzeFinancialViability: equity injection floor comes from equityInjectionFloor, not a locally re-derived isNewBusiness switch", () => {
  const result = analyzeFinancialViability({
    ...BASE_INPUT,
    equityInjectionPct: 0.15,
    equityInjectionFloor: 0.1,
    isNewBusiness: true,
  });
  // 15% >= 10% floor -> no critical capitalization flag, even though isNewBusiness is true.
  assert.equal(
    result.flags.some((f) => f.dimension === "capitalizationAdequacy"),
    false,
  );
  assert.match(result.capitalizationAdequacy.detail, /Minimum required: 10%/);
});

test("analyzeFinancialViability: equity injection below the passed-in floor is flagged critical", () => {
  const result = analyzeFinancialViability({
    ...BASE_INPUT,
    equityInjectionPct: 0.05,
    equityInjectionFloor: 0.1,
    isNewBusiness: true,
  });
  assert.equal(
    result.flags.some((f) => f.dimension === "capitalizationAdequacy" && f.severity === "critical"),
    true,
  );
});
