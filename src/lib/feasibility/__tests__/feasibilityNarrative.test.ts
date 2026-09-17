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
