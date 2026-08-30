import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../buildMemoInputPackage.ts"),
  "utf8",
);

test("memo input assembly returns a structured load failure", () => {
  assert.match(source, /reason: "load_failed"/);
  assert.match(source, /error: loadFailureCode\(error\)/);
  assert.match(source, /memo_input_load_failed/);
});

test("every authoritative memo input read proves database success", () => {
  for (const evidenceSource of [
    "borrower_story",
    "management_profiles",
    "collateral_items",
    "financial_facts",
    "financial_snapshot",
    "research_missions",
    "research_quality_gate",
    "research_mission_gate",
    "banker_overrides",
    "required_documents",
    "policy_exceptions",
  ]) {
    assert.ok(
      source.includes(`requireMemoInputQuery("${evidenceSource}"`),
      `missing database-error proof for ${evidenceSource}`,
    );
  }
});

test("hard readiness gates never convert database errors to healthy state", () => {
  const documents = source.slice(
    source.indexOf("async function loadUnfinalizedRequiredDocCount"),
    source.indexOf("async function loadPolicyExceptionsReviewed"),
  );
  const policy = source.slice(
    source.indexOf("async function loadPolicyExceptionsReviewed"),
    source.indexOf("function numOrNull"),
  );

  assert.doesNotMatch(documents, /catch[\s\S]*return 0/);
  assert.doesNotMatch(policy, /catch[\s\S]*return true/);
  assert.match(documents, /requireMemoInputQuery\("required_documents", error\)/);
  assert.match(policy, /requireMemoInputQuery\("policy_exceptions", error\)/);
});
