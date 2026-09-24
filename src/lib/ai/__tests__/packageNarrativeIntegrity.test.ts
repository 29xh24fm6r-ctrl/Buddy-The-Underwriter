import test from "node:test";
import assert from "node:assert/strict";
import { auditFundingNarrative, auditProjectionNarrative } from "../projectionNarrativeAudit";
import { fundingScheduleText, downsideDisclosure, projectionSummaryText } from "../packageNarrativeEvidence";
import type { SensitivityScenario, SourcesAndUsesResult } from "@/lib/sba/sbaReadinessTypes";

const schedule = {
  sources: [{ label: "SBA loan", amount: 950000 }, { label: "Cash equity", amount: 250000 }],
  uses: [{ label: "Leasehold construction", amount: 600000 }, { label: "Equipment", amount: 350000 },
    { label: "Initial inventory", amount: 25000 }, { label: "Initial franchise fee (illustrative)", amount: 50000 },
    { label: "Working capital", amount: 175000 }], totalSources: 1200000, totalUses: 1200000,
} as SourcesAndUsesResult;
const downside = { name: "downside", dscrYear1: 1.44, dscrYear2: .77, dscrYear3: .14, passesSBAThreshold: false } as SensitivityScenario;
const facts = { sources_and_uses: schedule, sensitivity_scenarios: [downside] };

test("production operations omission and generic franchise label are blocking even with correct totals elsewhere", () => {
  const issues = auditFundingNarrative(facts, [
    { key: "business_overview_narrative", text: fundingScheduleText(schedule) },
    { key: "operations_plan", text: "The $950,000 loan and $250,000 equity will fund $600,000 construction, $350,000 equipment, $25,000 inventory and $50,000 other project costs." },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "critical");
  assert.match(issues[0].repairInstruction, /Working capital: \$175,000/);
  assert.match(issues[0].repairInstruction, /Initial franchise fee \(illustrative\): \$50,000/);
});

test("complete allocation passes, including equal-valued uses with distinct labels", () => {
  const equal = { ...schedule, uses: [...schedule.uses, { label: "Closing costs", amount: 50000, pctOfTotal: 0, category: "other" }] };
  const sections = [{ key: "operations_plan", text: fundingScheduleText(equal) }];
  assert.deepEqual(auditFundingNarrative({ sourcesAndUses: equal }, sections), []);
  sections[0].text = sections[0].text.replace("Closing costs: $50,000; ", "").replace("; Closing costs: $50,000", "");
  assert.equal(auditFundingNarrative({ sourcesAndUses: equal }, sections).length, 1);
});

test("operations, SWOT, thesis and assumptions cannot imply coverage from only the strong base year", () => {
  const sections = ["operations_plan", "swot_strengths", "plan_thesis", "projections_assumptions_narrative"].map(key => ({ key,
    text: "Strong 2.66x DSCR and 38.1% margin of safety provide resilience against early revenue shortfalls." }));
  assert.equal(auditProjectionNarrative(facts, sections).length, 4);
  for (const section of sections) section.text = `Conditional base case. ${downsideDisclosure([downside])}`;
  assert.deepEqual(auditProjectionNarrative(facts, sections), []);
});

test("unrelated missing evidence cannot masquerade as a downside failure disclosure", () => {
  const sections = [{ key: "repayment_analysis", text: "Downside DSCR is 1.44x, 0.77x and 0.14x. The borrower fails to provide a lease. Coverage is strong." }];
  assert.equal(auditProjectionNarrative(facts, sections).length, 1);
  assert.deepEqual(auditProjectionNarrative(facts, [{ key: "market_analysis", text: "Local competition needs research." }]), []);
});

test("frozen source output takes precedence over conflicting package copies", () => {
  const authoritative = { ...facts, sensitivity_scenarios: [{ ...downside, passesSBAThreshold: true }],
    authoritativeFinancials: { projectionModel: { sensitivityScenarios: [downside] }, sourcesAndUses: schedule } };
  assert.equal(auditProjectionNarrative(authoritative, [{ key: "executive_summary", text: "Strong repayment." }]).length, 1);
});

test("rendered financial callout qualifies base coverage and discloses failed later years", () => {
  const text = projectionSummaryText({ ebitda: 400000, totalDebtService: 150651.84, dscr: 2.66 }, 1.25, [downside]);
  assert.match(text, /Base-case DSCR of 2.66x meets/);
  assert.match(text, /Year 2 0.77x, Year 3 0.14x/);
  assert.match(text, /fails the model's coverage threshold/);
  assert.doesNotMatch(text, /166%|cushion above|generates/);
});
