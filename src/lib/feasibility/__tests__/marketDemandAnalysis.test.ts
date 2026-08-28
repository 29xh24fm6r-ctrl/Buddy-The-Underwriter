import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { analyzeMarketDemand } =
  require("../marketDemandAnalysis") as typeof import("../marketDemandAnalysis");

function input(naicsCode: string) {
  return {
    city: "Test",
    state: "GA",
    zipCode: null,
    naicsCode,
    naicsDescription: "Machine Shops",
    projectedAnnualRevenue: 2_753_880,
    industryGrowthRate: 0.032,
    research: {
      marketIntelligence: null,
      competitiveLandscape: null,
      industryOverview: null,
      demographicTrends: null,
    },
    franchise: null,
    benchmark: null,
    tradeArea: {
      populationRadius5mi: 978_000,
      medianHouseholdIncome: 79_000,
      competitorCount: null,
      populationGrowthRate5yr: null,
    },
  } as any;
}

test("manufacturing NAICS excludes consumer population adequacy from decision evidence", () => {
  const result = analyzeMarketDemand(input("332710"));

  assert.equal(result.populationAdequacy.score, 50);
  assert.equal(result.populationAdequacy.dataAvailable, false);
  assert.match(result.populationAdequacy.detail, /not decision-useful.*B2B/i);
  assert.doesNotMatch(result.populationAdequacy.detail, /revenue per capita/i);
  assert.equal(result.demandTrend.dataSource, "Governed industry market-growth research");
  // Weight-aware over applicable metrics: consumer trade-area population
  // (0.30) leaves the denominator, income (0.20) and industry growth (0.20)
  // are backed, competitive density (0.30) is a real gap. 0.40 / 0.70.
  assert.equal(result.dataCompleteness, 0.4 / 0.7);
  assert.deepEqual(result.coverage.missing, ["competitiveDensity"]);
  assert.deepEqual(
    result.coverage.notApplicable.map((n) => n.key),
    ["populationAdequacy"],
  );
  assert.ok(
    result.flags.some(
      (flag) =>
        flag.dimension === "populationAdequacy" &&
        /excluded from decision evidence/i.test(flag.message),
    ),
  );
});

test("consumer-sector population scoring remains active", () => {
  const result = analyzeMarketDemand(input("722511"));

  assert.equal(result.populationAdequacy.score, 90);
  assert.equal(result.populationAdequacy.dataAvailable, true);
  assert.match(result.populationAdequacy.detail, /978,000/);
});
