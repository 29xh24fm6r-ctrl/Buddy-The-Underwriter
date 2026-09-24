import test from "node:test";
import assert from "node:assert/strict";
import { auditProjectionNarrative } from "../projectionNarrativeAudit";
const scenario = { name: "downside", dscrYear1: 1.4404, dscrYear2: .7355, dscrYear3: .0842, passesSBAThreshold: false };
test("first-year-only recommendation cannot pass a failed multi-year downside", () => {
  const issues = auditProjectionNarrative({ projectionPackage: { sensitivityScenarios: [scenario] } }, [
    { key: "recommendation", text: "Strong 2.66 base and viable 1.44 downside supports proceeding." },
    { key: "market_analysis", text: "Market evidence is limited." },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "critical");
  assert.match(issues[0].repairInstruction, /Year 2 0.74x, Year 3 0.08x/);
});
test("complete risk disclosure passes in either package evidence shape", () => {
  const sections = [{ key: "executive_summary", text: "Downside DSCR 1.44x, 0.74x, 0.08x fails coverage in later years. Lender review is required." }];
  assert.deepEqual(auditProjectionNarrative({ sensitivity_scenarios: [scenario] }, sections), []);
  assert.deepEqual(auditProjectionNarrative(JSON.stringify({ projectionPackage: { sensitivityScenarios: [scenario] } }), sections), []);
});
test("no invented threshold or fabricated downside data", () => {
  const sections = [{ key: "recommendation", text: "Needs review" }];
  assert.deepEqual(auditProjectionNarrative({}, sections), []);
  assert.deepEqual(auditProjectionNarrative({ sensitivity_scenarios: [{ ...scenario, passesSBAThreshold: true }] }, sections), []);
});

test("credit memo repayment and income sections must disclose the available projection downside", () => {
  const issues = auditProjectionNarrative({ projectionPackage: { sensitivityScenarios: [scenario] } }, [
    { key: "income_analysis", text: "Strong coverage supports repayment." },
    { key: "repayment_analysis", text: "All stress results are unavailable." },
    { key: "guarantor_strength", text: "Ongoing personal income needs confirmation." },
  ]);
  assert.deepEqual(issues.map(issue => issue.sectionKey), ["income_analysis", "repayment_analysis"]);
  assert.ok(issues.every(issue => issue.severity === "critical"));
});
