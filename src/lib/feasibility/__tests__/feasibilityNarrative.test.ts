import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { buildFeasibilityNarrativePrompts } = require("../feasibilityNarrative") as typeof import("../feasibilityNarrative");

test("every feasibility section receives the same borrower, management and financial evidence without example contamination", () => {
  const prompts = buildFeasibilityNarrativePrompts({
    dealName: "Apex Precision Fabrication LLC", city: "Fort Worth", state: "TX", industry: "Manufacturing",
    managementTeam: [{ name: "Jordan Ellis", title: "President", yearsInIndustry: 17, bio: "Machining experience" }, { name: "Renee Morgan", title: "Operations Manager", yearsInIndustry: 12, bio: "Scheduling experience" }],
    composite: { overallScore: 70, recommendation: "Conditionally Feasible", allFlags: [{ message: "Downside DSCR 0.86" }] },
    marketDemand: { competitiveDensity: { dataAvailable: false, detail: "Competitor count not available" } },
    financialViability: {}, operationalReadiness: {}, locationSuitability: {},
    research: { marketIntelligence: "Unverified legacy prose about a different business in Flowery Branch, $78,400, 12% growth" },
    financialEvidence: { workingCapital: { targetDSO: 42 }, sourcesAndUses: { equipment: 750000 } },
    isFranchise: false, brandName: null, franchiseComparison: null,
  } as any);
  assert.equal(prompts.length, 7);
  const contexts = prompts.map(({ prompt }) => prompt.split("SHARED DEAL EVIDENCE:\n")[1].split("\n\nReturn ONLY")[0]);
  assert.equal(new Set(contexts).size, 1);
  for (const { prompt } of prompts) {
    assert.match(prompt, /Apex Precision Fabrication LLC/);
    assert.match(prompt, /Fort Worth/);
    assert.match(prompt, /Jordan Ellis/);
    assert.match(prompt, /Renee Morgan/);
    assert.match(prompt, /"targetDSO":42/);
    assert.match(prompt, /"dataAvailable":false/);
    assert.doesNotMatch(prompt, /Flowery Branch|78,400|12% growth/);
  }
});

const { generateFeasibilityNarratives } = require("../feasibilityNarrative") as typeof import("../feasibilityNarrative");
const { assessFeasibilityNarratives } = require("../../brokerage/trident/narrativeAcceptance");
const input: any = { dealName: "QA 7 Brew", city: "Flowery Branch", state: "GA", managementTeam: [], isFranchise: true, brandName: null, franchiseComparison: null, borrowerContext: { franchiseDescription: "7 Brew in Flowery Branch", franchiseDeclared: true } };
const substantive = "Only supplied borrower statements and calculated results inform this assessment. Missing research remains unavailable and must be obtained before a final lender decision. The proposed project requires additional review of market demand, location suitability, management readiness and projected financial performance. This narrative establishes neither verified historical results nor an approval of credit.";

test("failed executive summary retries once with identical evidence, preserving successful sections", async () => {
  const counts: Record<string, number> = {};
  const result = await generateFeasibilityNarratives(input, async prompt => {
    const key = prompt.match(/Write the (\w+) section/)![1];
    counts[key] = (counts[key] ?? 0) + 1;
    assert.match(prompt, /7 Brew in Flowery Branch/);
    if (key === "executiveSummary" && counts[key] === 1) throw new Error("transient");
    return JSON.stringify({ [key]: substantive });
  });
  assert.equal(counts.executiveSummary, 2);
  assert.equal(counts.marketDemandNarrative, 1);
  assert.equal(assessFeasibilityNarratives(result).ok, true);
});
test("persistent placeholder or malformed JSON never clears final acceptance; retries are bounded", async () => {
  let calls = 0;
  const result = await generateFeasibilityNarratives(input, async () => { calls++; return '{"wrong":"field"}'; });
  assert.equal(calls, 14);
  assert.equal(assessFeasibilityNarratives(result).ok, false);
});
