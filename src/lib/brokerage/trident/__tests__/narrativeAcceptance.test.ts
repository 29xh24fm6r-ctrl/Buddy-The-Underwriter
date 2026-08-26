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

test("business-plan acceptance requires every substantive core section", () => {
  const result = assessBusinessPlanNarratives({
    business_overview_narrative: prose,
    executive_summary: prose,
    industry_analysis: prose,
    marketing_strategy: prose,
    operations_plan: prose,
  });
  assert.equal(result.ok, false);
  assert.equal(result.substantive, 5);

  const complete = assessBusinessPlanNarratives({
    business_overview_narrative: prose,
    executive_summary: prose,
    industry_analysis: prose,
    marketing_strategy: prose,
    operations_plan: prose,
    swot_strengths: prose,
    swot_weaknesses: prose,
    swot_opportunities: prose,
    swot_threats: prose,
    sensitivity_narrative: prose,
  });
  assert.deepEqual(complete, { ok: true, substantive: 10, total: 10 });
});

test("business-plan acceptance rejects serialized JSON presentation leaks", () => {
  const leaked = `\`\`\`json\n${JSON.stringify({ narrative: prose })}\n\`\`\``;
  const result = assessBusinessPlanNarratives(
    Object.fromEntries([
      "business_overview_narrative", "executive_summary", "industry_analysis",
      "marketing_strategy", "operations_plan", "swot_strengths", "swot_weaknesses",
      "swot_opportunities", "swot_threats", "sensitivity_narrative",
    ].map((field) => [field, field === "industry_analysis" ? leaked : prose])),
  );
  assert.equal(result.ok, false);
  assert.equal(result.substantive, 9);
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

// ── Feasibility narratives are keyed, not counted (audit F-10) ──────────────

const SUBSTANTIVE = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");

function feasibilityNarratives(overrides: Record<string, unknown> = {}) {
  return {
    executiveSummary: SUBSTANTIVE,
    marketDemandNarrative: SUBSTANTIVE,
    financialViabilityNarrative: SUBSTANTIVE,
    operationalReadinessNarrative: SUBSTANTIVE,
    locationSuitabilityNarrative: SUBSTANTIVE,
    riskAssessment: SUBSTANTIVE,
    recommendation: SUBSTANTIVE,
    franchiseComparisonNarrative: null,
    ...overrides,
  };
}

test("feasibility acceptance passes when all five required sections are substantive", () => {
  const r = assessFeasibilityNarratives(feasibilityNarratives());
  assert.equal(r.ok, true);
  assert.equal(r.substantive, 5);
  assert.equal(r.required, 5);
});

test("feasibility acceptance passes without the optional franchise narrative", () => {
  const r = assessFeasibilityNarratives(
    feasibilityNarratives({ franchiseComparisonNarrative: null, riskAssessment: "" }),
  );
  assert.equal(r.ok, true, "only the five required sections gate acceptance");
});

test("riskAssessment and recommendation cannot substitute for a missing dimension", () => {
  // The pre-fix check counted any five substantive values, so this shape —
  // three scored dimensions blank — passed and shipped a PDF with visible gaps.
  const r = assessFeasibilityNarratives(
    feasibilityNarratives({
      financialViabilityNarrative: "",
      operationalReadinessNarrative: "",
      locationSuitabilityNarrative: "",
      franchiseComparisonNarrative: SUBSTANTIVE,
    }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.substantive, 2);
});

test("each required feasibility section is individually load-bearing", () => {
  for (const field of [
    "executiveSummary",
    "marketDemandNarrative",
    "financialViabilityNarrative",
    "operationalReadinessNarrative",
    "locationSuitabilityNarrative",
  ]) {
    const r = assessFeasibilityNarratives(feasibilityNarratives({ [field]: "" }));
    assert.equal(r.ok, false, `${field} must be required`);
    assert.equal(r.substantive, 4);
  }
});

test("a thin required section does not count as substantive", () => {
  const r = assessFeasibilityNarratives(
    feasibilityNarratives({ marketDemandNarrative: "Too short." }),
  );
  assert.equal(r.ok, false);
});

test("missing narratives object fails closed", () => {
  const r = assessFeasibilityNarratives(null);
  assert.equal(r.ok, false);
  assert.equal(r.substantive, 0);
});

/**
 * Audit F-20. isPresentationSafe was applied to the ten business-plan fields
 * but not to the feasibility sections, even though both are model output
 * rendered verbatim into a lender-facing committee PDF and both run through
 * this module's acceptance gate. A feasibility section returned as a fenced
 * JSON blob is long enough to clear the word count.
 */
const RAW_JSON_FENCE =
  '```json\n{"marketDemandNarrative": "The market analysis indicates sustained ' +
  'demand across the defined trade area, with steady population growth and ' +
  'favourable household income trends supporting the projected revenue ramp ' +
  'over the first three operating years of the subject business. Competitive ' +
  'density remains moderate relative to comparable metropolitan submarkets, ' +
  'and no announced entrant is expected to materially erode the projected ' +
  'share captured by the borrower during the projection horizon."}\n```';

const RAW_JSON_OBJECT =
  '{"narrative": "The market analysis indicates sustained demand across the ' +
  'defined trade area, with steady population growth and favourable ' +
  'household income trends supporting the projected revenue ramp over the ' +
  'first three operating years of the subject business. Competitive density ' +
  'remains moderate relative to comparable metropolitan submarkets, and no ' +
  'announced entrant is expected to materially erode the projected share ' +
  'captured by the borrower over the projection horizon as presented."}';

test("[F-20] a fenced JSON blob is not an acceptable feasibility section", () => {
  assert.ok(
    RAW_JSON_FENCE.trim().split(/\s+/).filter(Boolean).length >= 45,
    "fixture must clear the word count, or this proves nothing",
  );
  const r = assessFeasibilityNarratives(
    feasibilityNarratives({ marketDemandNarrative: RAW_JSON_FENCE }),
  );
  assert.equal(r.ok, false, "raw model scaffolding must not reach a committee PDF");
  assert.equal(r.substantive, 4);
});

test("[F-20] a bare JSON object is not an acceptable feasibility section", () => {
  assert.ok(RAW_JSON_OBJECT.trim().split(/\s+/).filter(Boolean).length >= 45);
  const r = assessFeasibilityNarratives(
    feasibilityNarratives({ executiveSummary: RAW_JSON_OBJECT }),
  );
  assert.equal(r.ok, false);
});

test("[F-20] every required feasibility section is checked, not just the first", () => {
  for (const field of [
    "executiveSummary",
    "marketDemandNarrative",
    "financialViabilityNarrative",
    "operationalReadinessNarrative",
    "locationSuitabilityNarrative",
  ]) {
    const r = assessFeasibilityNarratives(
      feasibilityNarratives({ [field]: RAW_JSON_FENCE }),
    );
    assert.equal(r.ok, false, `${field} must reject unsafe presentation`);
  }
});

test("[F-20] prose that merely mentions braces or code is still accepted", () => {
  // The guard must not reject legitimate analysis. Only leading raw JSON and
  // fenced blocks are unsafe.
  const proseWithBraces =
    "Management reports that the point-of-sale vendor exports data in a JSON " +
    "format, and the { } notation appears throughout that vendor's " +
    "documentation. This has no bearing on demand, which remains supported " +
    "by the trade-area population growth and the household income trends " +
    "described above across the projection horizon.";
  assert.ok(proseWithBraces.trim().split(/\s+/).filter(Boolean).length >= 45);
  const r = assessFeasibilityNarratives(
    feasibilityNarratives({ marketDemandNarrative: proseWithBraces }),
  );
  assert.equal(r.ok, true);
});
