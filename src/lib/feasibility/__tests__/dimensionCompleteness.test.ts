import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { computeDimensionCompleteness } =
  require("../dimensionCompleteness") as typeof import("../dimensionCompleteness");
const { computeCompositeFeasibility } =
  require("../feasibilityScorer") as typeof import("../feasibilityScorer");
const { analyzeLocationSuitability } =
  require("../locationSuitabilityAnalysis") as typeof import("../locationSuitabilityAnalysis");

function metric(weight: number, dataAvailable: boolean, notApplicable = false) {
  return {
    score: 50,
    weight,
    dataSource: "test",
    dataAvailable,
    detail: "test",
    ...(notApplicable
      ? { notApplicable: true, notApplicableReason: "does not bear on this borrower" }
      : {}),
  };
}

// ── The measure itself ──────────────────────────────────────────────────

test("completeness weights each metric by its share of the decision", () => {
  // The pre-fix measure counted metrics, not weight: this pair scored 1/2 =
  // 50% whichever of the two happened to be available. It is 30% or 70%.
  const heavyMissing = computeDimensionCompleteness([
    { key: "heavy", score: metric(0.7, false) },
    { key: "light", score: metric(0.3, true) },
  ]);
  const lightMissing = computeDimensionCompleteness([
    { key: "heavy", score: metric(0.7, true) },
    { key: "light", score: metric(0.3, false) },
  ]);

  assert.equal(heavyMissing.completeness, 0.3);
  assert.equal(lightMissing.completeness, 0.7);
});

test("not-applicable metrics leave the denominator, missing metrics do not", () => {
  const result = computeDimensionCompleteness([
    { key: "applies", score: metric(0.5, true) },
    { key: "missing", score: metric(0.25, false) },
    { key: "excluded", score: metric(0.25, false, true) },
  ]);

  assert.equal(result.completeness, 0.5 / 0.75);
  assert.deepEqual(result.missing, ["missing"]);
  assert.deepEqual(result.notApplicable, [
    { key: "excluded", reason: "does not bear on this borrower" },
  ]);
  assert.equal(result.applicableWeight, 0.75);
  assert.equal(result.totalWeight, 1);
});

test("a dimension with nothing applicable reports zero coverage, never a vacuous 1.0", () => {
  const result = computeDimensionCompleteness([
    { key: "excluded", score: metric(0.5, false, true) },
    { key: "alsoExcluded", score: metric(0.5, false, true) },
  ]);

  assert.equal(result.completeness, 0);
  assert.deepEqual(result.missing, []);
});

test("an exclusion with no recorded reason is reported, not dropped silently", () => {
  const result = computeDimensionCompleteness([
    {
      key: "unexplained",
      score: { score: 50, weight: 1, dataSource: "t", dataAvailable: false, detail: "t", notApplicable: true },
    },
  ]);

  assert.deepEqual(result.notApplicable, [{ key: "unexplained", reason: "no reason recorded" }]);
});

// ── Applicability is driven by loan-file facts, not by absent data ───────

function locationInput(overrides: Record<string, unknown> = {}) {
  return {
    city: "Test",
    state: "GA",
    zipCode: null,
    naicsCode: "332710",
    financesRealProperty: false,
    research: {
      marketIntelligence: "Market is improving.",
      areaSpecificRisks: "No natural disaster exposure identified.",
      realEstateMarket: null,
      trendDirection: "improving" as const,
    },
    tradeArea: {
      unemploymentRate: 0.041,
      medianHouseholdIncome: 79_000,
      populationGrowthRate5yr: null,
      commercialVacancyRate: null,
      medianRentPsf: null,
    },
    property: null,
    ...overrides,
  } as Parameters<typeof analyzeLocationSuitability>[0];
}

test("a loan financing no real property is not charged for a missing property", () => {
  const result = analyzeLocationSuitability(locationInput());

  assert.equal(result.realEstateMarket.notApplicable, true);
  assert.equal(result.realEstateMarket.dataAvailable, false);
  assert.ok(result.coverage.notApplicable.some((n) => n.key === "realEstateMarket"));
  assert.ok(!result.coverage.missing.includes("realEstateMarket"));
});

test("an unknown use of proceeds still reads as a missing property, not an exclusion", () => {
  // `null` is absence of information. Treating it as "no property" would let
  // a deal whose loan file simply never loaded claim complete coverage.
  const result = analyzeLocationSuitability(locationInput({ financesRealProperty: null }));

  assert.notEqual(result.realEstateMarket.notApplicable, true);
  assert.ok(result.coverage.missing.includes("realEstateMarket"));
});

test("a real-estate loan is still charged for a missing property", () => {
  const result = analyzeLocationSuitability(locationInput({ financesRealProperty: true }));

  assert.notEqual(result.realEstateMarket.notApplicable, true);
  assert.ok(result.coverage.missing.includes("realEstateMarket"));
});

test("retail traffic counts are excluded for a manufacturer but not for a restaurant", () => {
  const manufacturer = analyzeLocationSuitability(locationInput());
  const restaurant = analyzeLocationSuitability(locationInput({ naicsCode: "722511" }));

  assert.equal(manufacturer.accessAndVisibility.notApplicable, true);
  assert.notEqual(restaurant.accessAndVisibility.notApplicable, true);
  assert.ok(restaurant.coverage.missing.includes("accessAndVisibility"));
});

// ── The composite the release gate reads ────────────────────────────────

function dimension(completeness: number, missing: string[] = []) {
  return {
    overallScore: 60,
    dataCompleteness: completeness,
    coverage: {
      completeness,
      applicableWeight: 1,
      totalWeight: 1,
      missing,
      notApplicable: [],
    },
    flags: [],
  } as any;
}

test("composite completeness weights dimensions the way the score does", () => {
  // Financial viability carries 0.35 of the decision and operational
  // readiness 0.15. A plain /4 average let them move the release gate by the
  // same amount.
  const financialStrong = computeCompositeFeasibility({
    marketDemand: dimension(0),
    financialViability: dimension(1),
    operationalReadiness: dimension(0),
    locationSuitability: dimension(0),
    isFranchise: false,
  });
  const operationalStrong = computeCompositeFeasibility({
    marketDemand: dimension(0),
    financialViability: dimension(0),
    operationalReadiness: dimension(1),
    locationSuitability: dimension(0),
    isFranchise: false,
  });

  assert.equal(financialStrong.overallDataCompleteness, 0.35);
  assert.equal(operationalStrong.overallDataCompleteness, 0.15);
});

test("composite names every missing metric so the release blocker is actionable", () => {
  const composite = computeCompositeFeasibility({
    marketDemand: dimension(0.5, ["demandTrend"]),
    financialViability: dimension(0.85, ["cashRunway"]),
    operationalReadiness: dimension(1),
    locationSuitability: dimension(1),
    isFranchise: false,
  });

  assert.deepEqual(composite.missingEvidence, [
    "market_demand.demandTrend",
    "financial_viability.cashRunway",
  ]);
});
