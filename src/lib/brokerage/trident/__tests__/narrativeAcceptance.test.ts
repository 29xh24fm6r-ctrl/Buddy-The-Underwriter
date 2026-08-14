import test from "node:test";
import assert from "node:assert/strict";
import {
  assessBusinessPlanNarratives,
  assessFeasibilityNarratives,
} from "../narrativeAcceptance";

const prose = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");

test("business-plan acceptance rejects renderer placeholders", () => {
  const result = assessBusinessPlanNarratives({
    business_overview_narrative: "Business overview not available.",
    executive_summary: "Executive summary not available.",
  });
  assert.deepEqual(result, { ok: false, substantive: 0, total: 10 });
});

test("business-plan acceptance requires five substantive core sections", () => {
  const result = assessBusinessPlanNarratives({
    business_overview_narrative: prose,
    executive_summary: prose,
    industry_analysis: prose,
    marketing_strategy: prose,
    operations_plan: prose,
  });
  assert.equal(result.ok, true);
  assert.equal(result.substantive, 5);
});

test("feasibility acceptance rejects generation-failed strings", () => {
  const result = assessFeasibilityNarratives({
    executiveSummary: "executiveSummary generation failed.",
    recommendation: "recommendation generation failed.",
  });
  assert.equal(result.ok, false);
  assert.equal(result.substantive, 0);
});

test("feasibility acceptance requires five substantive narratives", () => {
  const result = assessFeasibilityNarratives({
    executiveSummary: prose,
    marketDemandNarrative: prose,
    financialViabilityNarrative: prose,
    operationalReadinessNarrative: prose,
    locationSuitabilityNarrative: prose,
  });
  assert.equal(result.ok, true);
});
