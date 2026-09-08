import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { evaluateTridentRelease } =
  require("../tridentReleaseGate") as typeof import("../tridentReleaseGate");
const { computeCompositeFeasibility } =
  require("../../../feasibility/feasibilityScorer") as typeof import("../../../feasibility/feasibilityScorer");
const { computeDimensionCompleteness } =
  require("../../../feasibility/dimensionCompleteness") as typeof import("../../../feasibility/dimensionCompleteness");

/**
 * Every metric below is transcribed from the production rows this deal
 * actually produced: buddy_feasibility_studies 5394b0b1-1174-439d-ba24-
 * 9cee73afc586 (deal d4b7104f, NAICS 332710) and buddy_sba_packages
 * 5e8bb939 (use of proceeds: Equipment $750,000 + Working Capital $250,000,
 * no real-property line). The run that consumed them recorded
 * data_completeness 0.6375 and failed with
 * "Golden Trident release blocked: feasibility_data_completeness_below_70_percent".
 */
function metric(weight: number, dataAvailable: boolean, notApplicable = false) {
  return {
    score: 50,
    weight,
    dataSource: "production",
    dataAvailable,
    detail: "production",
    ...(notApplicable ? { notApplicable: true, notApplicableReason: "does not bear on this borrower" } : {}),
  };
}

// NAICS 332710 — machine shop. Consumer trade-area population does not apply;
// competitive density and demand trend are real gaps.
const marketDemandCoverage = computeDimensionCompleteness([
  { key: "populationAdequacy", score: metric(0.3, false, true) },
  { key: "incomeAlignment", score: metric(0.2, true) },
  { key: "competitiveDensity", score: metric(0.3, false) },
  { key: "demandTrend", score: metric(0.2, false) },
]);
const financialCoverage = computeDimensionCompleteness([
  { key: "debtServiceCoverage", score: metric(0.3, true) },
  { key: "breakEvenMargin", score: metric(0.2, true) },
  { key: "capitalizationAdequacy", score: metric(0.15, true) },
  { key: "cashRunway", score: metric(0.15, false) },
  { key: "downsideResilience", score: metric(0.2, true) },
]);
const operationalCoverage = computeDimensionCompleteness([
  { key: "managementExperience", score: metric(0.35, true) },
  { key: "industryKnowledge", score: metric(0.3, true) },
  { key: "staffingReadiness", score: metric(0.35, true) },
]);
// No real-property proceeds, and no walk-in trade for a machine shop.
const locationCoverage = computeDimensionCompleteness([
  { key: "economicHealth", score: metric(0.3, true) },
  { key: "realEstateMarket", score: metric(0.25, false, true) },
  { key: "accessAndVisibility", score: metric(0.2, false, true) },
  { key: "riskExposure", score: metric(0.25, true) },
]);

function dimension(coverage: ReturnType<typeof computeDimensionCompleteness>) {
  return { overallScore: 60, dataCompleteness: coverage.completeness, coverage, flags: [] } as any;
}

const composite = computeCompositeFeasibility({
  marketDemand: dimension(marketDemandCoverage),
  financialViability: dimension(financialCoverage),
  operationalReadiness: dimension(operationalCoverage),
  locationSuitability: dimension(locationCoverage),
  isFranchise: false,
});

test("the QA fixture's real evidence clears the 70% release gate", () => {
  // 0.6375 stored in production, against a gate of 0.70 that no study in the
  // system had ever cleared by more than 0.0 — the ceiling was exactly 0.70.
  assert.ok(
    composite.overallDataCompleteness >= 0.7,
    `expected >= 0.70, got ${composite.overallDataCompleteness}`,
  );
});

test("clearing the gate does not fabricate coverage for evidence that is genuinely absent", () => {
  // The three real gaps must still be reported as gaps. If a future change
  // clears the gate by excluding these instead of sourcing them, this fails.
  assert.deepEqual(composite.missingEvidence, [
    "market_demand.competitiveDensity",
    "market_demand.demandTrend",
    "financial_viability.cashRunway",
  ]);
  assert.ok(Math.abs(marketDemandCoverage.completeness - 0.2 / 0.7) < 1e-9);
  assert.ok(Math.abs(financialCoverage.completeness - 0.85) < 1e-9);
});

test("every excluded metric carries a recorded reason", () => {
  const excluded = [
    ...marketDemandCoverage.notApplicable,
    ...financialCoverage.notApplicable,
    ...operationalCoverage.notApplicable,
    ...locationCoverage.notApplicable,
  ];

  assert.ok(excluded.length > 0);
  for (const entry of excluded) {
    assert.notEqual(entry.reason, "no reason recorded", `${entry.key} was excluded without a reason`);
  }
});

function release(overrides: Record<string, unknown> = {}) {
  return evaluateTridentRelease({
    businessPlanVerdict: "pass",
    feasibilityVerdict: "pass",
    feasibilityCompleteness: composite.overallDataCompleteness,
    businessPlanAdvisoryCount: 0,
    feasibilityAdvisoryCount: 0,
    feasibilityMissingEvidence: composite.missingEvidence,
    feasibilityCitationCount: 3,
    projectionsNarrative: Array.from({ length: 40 }, () => "word").join(" "),
    sourcesAndUses: { balanced: true, imbalance: 0 },
    memoId: "memo-1",
    memoInputHash: "hash-1",
    expectedMemoInputHash: "hash-1",
    memoResearchTrustGrade: "committee_grade",
    spreadId: "spread-1",
    spreadReady: true,
    spreadHasIntegrityHash: true,
    spreadHasCanonicalFactsTimestamp: true,
    spreadAccuracyStatus: "clean",
    spreadAccuracyBlockerCount: 0,
    artifactPaths: ["a", "b", "c"],
    isTestDeal: false,
    ...overrides,
  });
}

test("the fixture's evidence no longer blocks release", () => {
  const gate = release();

  assert.deepEqual(gate.reasons, []);
  assert.equal(gate.ok, true);
});

test("a completeness blocker names the evidence a lender would have to supply", () => {
  // The production failure read "feasibility_data_completeness_below_70_percent"
  // and nothing else — 33 runs blocked with no way to learn what was missing.
  const gate = release({
    feasibilityCompleteness: 0.5,
    feasibilityMissingEvidence: ["financial_viability.cashRunway", "market_demand.demandTrend"],
  });

  const blocker = gate.reasons.find((r) => r.startsWith("feasibility_data_completeness_below_70_percent"));
  assert.ok(blocker, "expected the completeness blocker");
  assert.match(blocker, /at 50%/);
  assert.match(blocker, /market_demand\.demandTrend/);
  assert.match(blocker, /financial_viability\.cashRunway/);
});

test("the blocker keeps its stable reason code as a prefix", () => {
  const gate = release({ feasibilityCompleteness: 0.5 });

  assert.ok(
    gate.reasons.some((r) => r.startsWith("feasibility_data_completeness_below_70_percent")),
  );
});
