import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { BUSINESS_PLAN_REQUIREMENTS, FEASIBILITY_REQUIREMENTS, narrativeCompletenessFindings } from "@/lib/brokerage/trident/narrativeAcceptance";
import type { ReviewCheckpoint } from "../reviewCheckpoint";
mockServerOnly();
const require = createRequire(import.meta.url);
let provider: (role: string, req: { prompt: string }) => Promise<{ text: string }>;
require.cache[require.resolve("../gateway")] = { loaded: true, exports: { runRole: (role: string, req: { prompt: string }) => provider(role, req) } } as any;
const { finishInstitutionalArtifact, reviewContentHash } = require("../frontierArtifactFactory") as typeof import("../frontierArtifactFactory");
const prose = "The proposed project depends on the borrower assumptions and deterministic calculations supplied for this review. Independent supporting evidence remains unavailable. The lender should verify the proposed operating arrangements and assess their effect on projected performance before reaching a credit decision. This analysis does not establish historical performance or approval of financing.";
const reply = (value: unknown) => ({ text: JSON.stringify(value) });
const complete = (requirements: Record<string, number>) => Object.keys(requirements).map(key => ({ key, text: prose }));

test("the production 44-word SWOT is repaired even when independent review reports no findings", async () => {
  const sections = complete(BUSINESS_PLAN_REQUIREMENTS);
  const short = "The business can capitalize on the demand from local commuters and residents in Flowery Branch seeking convenient beverage options. Initial market strategy includes local promotions and digital advertising, potentially increasing customer engagement. Community partnerships may enhance brand visibility and customer loyalty in the locality.";
  assert.equal(short.split(/\s+/).length, 44);
  sections.find(s => s.key === "swot_opportunities")!.text = short;
  let repairs = 0, reviews = 0;
  provider = async (role, req) => {
    if (role === "verifier") { reviews++; return reply({ issues: [] }); }
    repairs++;
    assert.match(req.prompt, /"swot_opportunities".*minimumWords/);
    assert.match(req.prompt, /contains 44 words/);
    return reply({ sections: [{ key: "swot_opportunities", text: prose }] });
  };
  const result = await finishInstitutionalArtifact({ artifactType: "business_plan", facts: {}, dealId: "qa", sections, narrativeRequirements: BUSINESS_PLAN_REQUIREMENTS });
  assert.equal(result.verdict, "pass"); assert.equal(repairs, 1); assert.equal(reviews, 2);
  assert.deepEqual(result.sections.filter(s => s.key !== "swot_opportunities"), sections.filter(s => s.key !== "swot_opportunities"));
});

test("missing feasibility dimensions are repair targets and JSON leaks are rejected", async () => {
  const sections = complete(FEASIBILITY_REQUIREMENTS).filter(s => s.key !== "locationSuitabilityNarrative");
  sections.find(s => s.key === "marketDemandNarrative")!.text = JSON.stringify({ narrative: prose });
  let repairs = 0;
  provider = async (role, req) => {
    if (role === "verifier") return reply({ issues: [] });
    repairs++;
    const keys: string[] = JSON.parse(req.prompt.split("REQUESTED REPAIR SECTION KEYS:\n\n")[1].split("\n\n")[0]);
    assert.deepEqual(keys.sort(), ["locationSuitabilityNarrative", "marketDemandNarrative"]);
    return reply({ sections: keys.map(key => ({ key, text: prose })) });
  };
  const result = await finishInstitutionalArtifact({ artifactType: "feasibility", facts: {}, dealId: "qa", sections, narrativeRequirements: FEASIBILITY_REQUIREMENTS });
  assert.equal(result.verdict, "pass"); assert.equal(repairs, 1);
  assert.deepEqual(narrativeCompletenessFindings(result.sections, FEASIBILITY_REQUIREMENTS), []);
  assert.ok(!result.sections.some(s => s.key === "franchiseComparisonNarrative"));
});

test("a repair that removes too much analysis is reviewed again and cannot publish", async () => {
  let repairs = 0, reviews = 0;
  provider = async role => role === "verifier" ? reply({ issues: reviews++ === 0 ? [{ sectionKey: "executive_summary", claim: "Unsupported conclusion", reason: "Remove unsupported conclusion", severity: "critical", category: "unsupported_fact", repairInstruction: "Use only supplied evidence" }] : [] }) : (repairs++, reply({ sections: [{ key: "executive_summary", text: "Evidence unavailable." }] }));
  const result = await finishInstitutionalArtifact({ artifactType: "business_plan", facts: {}, dealId: "qa", sections: [{ key: "executive_summary", text: prose }], narrativeRequirements: { executive_summary: 45 } });
  assert.equal(repairs, 3); assert.equal(result.verdict, "flagged");
  assert.equal(result.reviewIssues[0].category, "missing_analysis");
});

test("terminal checkpoints and changed requirements cannot reuse an incomplete pass", async () => {
  const sections = [{ key: "executive_summary", text: "Short." }];
  const state: ReviewCheckpoint = { version: 1, cycle: 1, phase: "done", sections, remaining: [], reviewPasses: 2, repaired: true, completedBatches: {} };
  provider = async () => { throw new Error("Terminal review must not replay paid calls"); };
  const input = { artifactType: "business_plan" as const, facts: {}, dealId: "qa", sections, narrativeRequirements: { executive_summary: 45 } };
  const result = await finishInstitutionalArtifact({ ...input, checkpoint: { state, save: async () => {} } });
  assert.equal(result.verdict, "flagged");
  assert.notEqual(reviewContentHash(input), reviewContentHash({ ...input, narrativeRequirements: { executive_summary: 35 } }));
});

test("every plan and feasibility requirement shares the publication word and presentation rules", () => {
  for (const requirements of [BUSINESS_PLAN_REQUIREMENTS, FEASIBILITY_REQUIREMENTS]) {
    for (const [key, minimum] of Object.entries(requirements)) {
      const sections = complete(requirements);
      sections.find(s => s.key === key)!.text = Array(minimum - 1).fill("evidence").join(" ");
      assert.deepEqual(narrativeCompletenessFindings(sections, requirements).map(f => f.key), [key]);
      sections.find(s => s.key === key)!.text += " limitation";
      assert.deepEqual(narrativeCompletenessFindings(sections, requirements), []);
    }
  }
});
