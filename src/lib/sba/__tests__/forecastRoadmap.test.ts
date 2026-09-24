import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { RoadmapInput } from "../sbaActionableRoadmap";

mockServerOnly();
const require = createRequire(import.meta.url);
let prompt = "";
let response = "Year 1 coverage is strong; you can comfortably cover all obligations.";
let fail = false;
require.cache[require.resolve("../../ai/gateway")] = { loaded: true, exports: { runRole: async (_role: string, req: { prompt: string }) => {
  prompt = req.prompt;
  if (fail) throw new Error("synthetic provider outage");
  return { text: response };
} } } as any;
require.cache[require.resolve("../sbaPackageNarrative")] = { loaded: true, exports: { callGeminiJSON: async (text: string) => {
  prompt = text; return '{"risks":[]}';
} } } as any;
const { generateActionableRoadmap } = require("../sbaActionableRoadmap") as typeof import("../sbaActionableRoadmap");
const { generateRiskContingencyMatrix } = require("../sbaBusinessPlanRoadmap") as typeof import("../sbaBusinessPlanRoadmap");
const input: RoadmapInput = {
  businessName: "Synthetic startup", loanAmount: 950000, revenue: 1500000, breakEvenRevenue: 1100000,
  marginOfSafetyPct: .27, dscrYear1: 2.66, dscrYear2: 2.90, dscrYear3: 3.17,
  downsideCoverage: [1.44, .77, .14], monthlyDebtService: 12554, grossMarginPct: .7,
  cogsPercent: .3, revenueGrowthY1: 0, dscrThreshold: 1.15,
};
test.afterEach(() => { fail = false; response = "Year 1 coverage is strong; you can comfortably cover all obligations."; });

test("borrower roadmap rejects a first-year-only model answer and supplies the actual shortfalls", async () => {
  const text = await generateActionableRoadmap(input);
  assert.match(prompt, /Model coverage threshold: 1.15x/);
  assert.match(prompt, /Year 1: 1.44x; Year 2: 0.77x; Year 3: 0.14x/);
  assert.doesNotMatch(prompt, /1.25|confident closing/);
  assert.match(text, /cannot cover debt service in Year 2 0.77x, Year 3 0.14x/);
  assert.doesNotMatch(text, /comfortably cover|revenue drops 15%|foundation is strong/);
});

test("provider-failure fallback and incomplete evidence never claim full-horizon resilience", async () => {
  fail = true;
  const text = await generateActionableRoadmap({ ...input, downsideCoverage: [1.44, null, null] });
  assert.match(text, /Year 2: not available; Year 3: not available/);
  assert.match(text, /Complete the missing forecast evidence/);
  assert.doesNotMatch(text, /all modeled years meet|comfortably cover/i);
});

test("a complete downside disclosure can pass the existing deterministic narrative audit", async () => {
  response = "Downside coverage is 1.44x, 0.77x and 0.14x; the downside fails debt service coverage in Years 2 and 3. Resolve these shortfalls before relying on repayment projections.";
  assert.equal(await generateActionableRoadmap(input), response);
});

test("risk-contingency generation receives every scenario year and the actual model floor", async () => {
  await generateRiskContingencyMatrix({ dealName: "QA", story: null, biggestRisk: null,
    dscrYear1: 2.66, dscrDownside: 1.44, projectedDscrThreshold: 1.15,
    breakEvenRevenue: 1100000, projectedRevenueYear1: 1500000, monthlyDebtService: 12554,
    fixedCosts: [], plannedHires: [], sensitivityScenarios: [
      { name: "downside", dscrYear1: 1.44, dscrYear2: .77, dscrYear3: .14, revenueYear1: 1275000 },
    ] });
  assert.match(prompt, /DSCR Y1\/Y2\/Y3 1.44x\/0.77x\/0.14x/);
  assert.match(prompt, /model coverage threshold is 1.15x/);
  assert.match(prompt, /Disclose every later-year coverage shortfall/);
  assert.doesNotMatch(prompt, /1.10x|1.25x/);
});
