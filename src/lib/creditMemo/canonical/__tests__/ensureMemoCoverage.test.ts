import assert from "node:assert/strict";
import test from "node:test";
import { ensureMemoCoverage, REQUIRED_CANONICAL_MEMO_SECTIONS } from "../ensureMemoCoverage";
import type { RiskOutput } from "@/lib/ai/provider";

const risk: RiskOutput = {
  grade: "BB+",
  baseRateBps: 500,
  riskPremiumBps: 225,
  pricingExplain: [],
  factors: [
    { label: "Coverage", category: "cashflow", direction: "positive", contribution: 0.4, confidence: 0.8, rationale: "Supported" },
    { label: "Concentration", category: "cashflow", direction: "negative", contribution: -0.3, confidence: 0.7, rationale: "Documented" },
  ],
};

test("completes the six-section canonical committee contract without replacing model prose", () => {
  const result = ensureMemoCoverage(
    { sections: [{ sectionKey: "executive_summary", title: "Executive Summary", content: "Model-authored summary.", citations: [] }] },
    { legalName: "Apex Precision Fabrication", loanAmount: 850000, revenue: 2400000, ebitda: 390000, dscr: 1.42 },
    risk,
  );

  assert.deepEqual(result.sections.slice(0, 6).map((section) => section.sectionKey), REQUIRED_CANONICAL_MEMO_SECTIONS);
  assert.equal(result.sections[0].content, "Model-authored summary.");
  for (const section of result.sections.slice(1, 6)) {
    assert.ok(section.content.split(/\s+/).length >= 35, `${section.sectionKey} should be substantive`);
  }
});

test("drops empty duplicate sections and preserves noncanonical substantive extras", () => {
  const result = ensureMemoCoverage(
    { sections: [
      { sectionKey: "risk_factors", title: "Risk", content: "", citations: [] },
      { sectionKey: "property_description", title: "Property", content: "Documented property narrative.", citations: [] },
    ] },
    {},
    risk,
  );

  assert.equal(result.sections.filter((section) => section.sectionKey === "risk_factors").length, 1);
  assert.equal(result.sections.at(-1)?.sectionKey, "property_description");
});
