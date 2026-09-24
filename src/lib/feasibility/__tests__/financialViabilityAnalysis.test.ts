import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFinancialViability } from "@/lib/feasibility/financialViabilityAnalysis";
import type { FinancialViabilityInput } from "@/lib/feasibility/types";

const BASE_INPUT: FinancialViabilityInput = {
  dscrYear1Base: null,
  dscrYear2Base: null,
  dscrYear3Base: null,
  breakEvenRevenue: null,
  projectedRevenueYear1: null,
  marginOfSafetyPct: null,
  downsideDscrYear1: null,
  downsideDscrYear2: null,
  downsideDscrYear3: null,
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

test("analyzeFinancialViability: coverage is checked against the supplied deal-specific floor", () => {
  const existing = analyzeFinancialViability({
    ...BASE_INPUT,
    dscrYear1Base: 1.15, dscrYear2Base: 1.2, dscrYear3Base: 1.3,
    isNewBusiness: false,
    projectedDscrThreshold: 1.1,
  });
  assert.equal(
    existing.flags.some((f) => f.dimension === "debtServiceCoverage" && f.severity === "critical"),
    false,
  );

  const startup = analyzeFinancialViability({
    ...BASE_INPUT,
    dscrYear1Base: 1.15, dscrYear2Base: 1.2, dscrYear3Base: 1.3,
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

const COMPLETE_INPUT: FinancialViabilityInput = {
  ...BASE_INPUT, dscrYear1Base: 2.66, dscrYear2Base: 2.90, dscrYear3Base: 3.17,
  downsideDscrYear1: 1.44, downsideDscrYear2: .77, downsideDscrYear3: .14,
  projectedDscrThreshold: 1.15, marginOfSafetyPct: .3, equityInjectionPct: .2083,
  workingCapitalReserveMonths: 1.9,
};

test("production regression: strong Year 1 cannot mask later downside debt-service failure", () => {
  const result = analyzeFinancialViability(COMPLETE_INPUT);
  assert.equal(result.downsideResilience.score, 10);
  assert.equal(result.overallScore, 65);
  assert.equal(result.dataCompleteness, 1);
  const risks = result.flags.filter(f => f.dimension === "downsideResilience");
  assert.equal(risks.length, 1, "one scenario is one critical risk, not three independent risks");
  assert.equal(risks[0].severity, "critical");
  for (const text of [risks[0].message, result.downsideResilience.detail]) {
    assert.match(text, /Year 2[: ]+0.77x/);
    assert.match(text, /Year 3[: ]+0.14x/);
    assert.match(text, /cannot cover debt service/);
    assert.doesNotMatch(text, /underperforms by 15%|can service its debt/);
  }
});

test("base scoring includes a Year 3 decline and threshold failure", () => {
  const result = analyzeFinancialViability({ ...COMPLETE_INPUT, dscrYear3Base: .9 });
  assert.equal(result.debtServiceCoverage.score, 5);
  const risk = result.flags.find(f => f.dimension === "debtServiceCoverage")!;
  assert.equal(risk.severity, "critical");
  assert.match(risk.message, /Year 3 0.90x/);
});

test("declining but adequately covered later years get a trend warning", () => {
  const result = analyzeFinancialViability({ ...COMPLETE_INPUT, dscrYear3Base: 2 });
  assert.equal(result.debtServiceCoverage.score, 90);
  assert.equal(result.flags.find(f => f.dimension === "debtServiceCoverage")?.severity, "warning");
});

test("fully covered downside remains conditional and uses the supplied floor", () => {
  const result = analyzeFinancialViability({ ...COMPLETE_INPUT, downsideDscrYear2: 1.3, downsideDscrYear3: 1.2 });
  assert.equal(result.downsideResilience.score, 75);
  assert.equal(result.flags.some(f => f.dimension === "downsideResilience"), false);
  assert.match(result.downsideResilience.detail, /1.15x threshold in all three years/);
  const stricter = analyzeFinancialViability({ ...COMPLETE_INPUT, downsideDscrYear2: 1.3, downsideDscrYear3: 1.2, projectedDscrThreshold: 1.3 });
  assert.equal(stricter.downsideResilience.score, 55);
  assert.match(stricter.flags.find(f => f.dimension === "downsideResilience")!.message, /1.30x threshold/);
  assert.doesNotMatch(stricter.downsideResilience.detail, /cannot cover debt service/);
});

test("missing and nonfinite later years are incomplete without hiding known shortfalls", () => {
  for (const absent of [null, NaN, Infinity, -Infinity]) {
    const result = analyzeFinancialViability({ ...COMPLETE_INPUT, dscrYear3Base: absent, downsideDscrYear3: absent });
    assert.equal(result.debtServiceCoverage.dataAvailable, false);
    assert.equal(result.downsideResilience.dataAvailable, false);
    assert.equal(result.downsideResilience.score, 0);
    assert.deepEqual(result.coverage.missing, ["debtServiceCoverage", "downsideResilience"]);
    assert.match(result.downsideResilience.detail, /Year 2 0.77x/);
    assert.match(result.downsideResilience.detail, /Missing coverage: Year 3/);
    assert.ok(Number.isFinite(result.overallScore));
  }
});

test("later downside failure prevents an unconditional composite recommendation", async () => {
  const { computeCompositeFeasibility } = await import("../feasibilityScorer");
  const dimension = { overallScore: 95, dataCompleteness: 1, coverage: { completeness: 1, missing: [], notApplicable: [] }, flags: [] };
  const composite = computeCompositeFeasibility({ marketDemand: dimension as any,
    operationalReadiness: dimension as any, locationSuitability: dimension as any,
    financialViability: analyzeFinancialViability(COMPLETE_INPUT), isFranchise: true });
  assert.ok(composite.overallScore >= 80);
  assert.equal(composite.criticalFlags, 1);
  assert.equal(composite.recommendation, "Conditionally Feasible");
});
