import test from "node:test";
import assert from "node:assert/strict";
import { protectFundingSchedule, withoutProtectedFundingSchedule } from "../protectedFundingSchedule";
import { fundingScheduleText } from "../packageNarrativeEvidence";
import { narrativeCompletenessFindings } from "@/lib/brokerage/trident/narrativeAcceptance";
import { auditFundingNarrative } from "../projectionNarrativeAudit";

const budget = { sources: [{ label: "Loan", amount: 100 }], uses: [{ label: "Illustrative franchise fee (other); quote unverified", amount: 100 }], totalSources: 100, totalUses: 100 };
const facts = { sourcesAndUses: budget };

test("protection is idempotent, restores tampered schedule values, and preserves prose and other sections", () => {
  const sections = [{ key: "operations_plan", text: "Conditional operating analysis." }, { key: "management", text: "Keep this unchanged." }];
  const protectedSections = protectFundingSchedule(facts, sections);
  assert.deepEqual(protectFundingSchedule(facts, protectedSections), protectedSections);
  assert.equal(protectedSections[1], sections[1]);
  assert.equal(withoutProtectedFundingSchedule(protectedSections[0].text), sections[0].text);
  const changed = protectedSections.map(s => ({ ...s, text: s.text.replaceAll("$100", "$900") }));
  assert.deepEqual(protectFundingSchedule(facts, changed), protectedSections);
  assert.deepEqual(auditFundingNarrative(facts, protectedSections), []);
  assert.match(protectedSections[0].text, /Illustrative franchise fee.*quote unverified/);
});

test("a copied schedule cannot satisfy the substantive narrative requirement", () => {
  const verbose = { ...budget, uses: [{ label: Array(80).fill("Source description").join(" "), amount: 100 }] };
  const sections = protectFundingSchedule({ sourcesAndUses: verbose }, [{ key: "operations_plan", text: "Too short." }]);
  const issues = narrativeCompletenessFindings(sections, { operations_plan: 45 });
  assert.equal(issues.length, 1); assert.equal(issues[0].words, 2);
});

test("missing or invalid funding evidence is never fabricated", () => {
  const sections = [{ key: "operations_plan", text: "Borrower needs to provide funding details." }];
  for (const input of [{}, "invalid JSON", { sourcesAndUses: { ...budget, totalUses: NaN } }]) {
    assert.deepEqual(protectFundingSchedule(input, sections), sections);
  }
});

test("the release audit still rejects removal or alteration after protected assembly", () => {
  const sections = protectFundingSchedule(facts, [{ key: "operations_plan", text: "Conditional analysis." }]);
  for (const text of [withoutProtectedFundingSchedule(sections[0].text), sections[0].text.replace(fundingScheduleText(budget), "Equipment: $900")]) {
    assert.equal(auditFundingNarrative(facts, [{ key: "operations_plan", text }]).length, 1);
  }
});
