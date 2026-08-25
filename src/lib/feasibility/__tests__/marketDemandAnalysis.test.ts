import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMarketDemand } from "../marketDemandAnalysis";

function input(naicsCode: string) {
  return {
    city: "Test",
    state: "GA",
    zipCode: null,
    naicsCode,
    naicsDescription: "Machine Shops",
    projectedAnnualRevenue: 2_753_880,
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
      medianHouseholdIncome: null,
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
