import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FLAG_RULES, getRule, getRulesByCategory } from "../flagRegistry";

describe("flagRegistry", () => {
  it("has at least 40 rules", () => {
    assert.ok(FLAG_RULES.length >= 40, `Expected 40+ rules, got ${FLAG_RULES.length}`);
  });

  it("every rule has all required fields", () => {
    for (const rule of FLAG_RULES) {
      assert.ok(rule.trigger_type.length > 0, "trigger_type must not be empty");
      assert.ok(["financial_irregularity", "missing_data", "policy_proximity", "qualitative_risk"].includes(rule.category));
      assert.ok(["critical", "elevated", "watch", "informational"].includes(rule.default_severity));
      assert.ok(rule.description.length > 0, "description must not be empty");
      assert.ok(Array.isArray(rule.canonical_keys_involved));
      assert.ok(typeof rule.generates_question === "boolean");
      assert.ok(["borrower", "accountant", "attorney", "appraiser"].includes(rule.recipient_type));
    }
  });

  it("trigger_types are unique", () => {
    const types = FLAG_RULES.map((r) => r.trigger_type);
    const unique = new Set(types);
    assert.equal(unique.size, types.length, "Duplicate trigger_type found");
  });

  it("getRule returns a rule by trigger_type", () => {
    const rule = getRule("dscr_below_1x");
    assert.ok(rule);
    assert.equal(rule.category, "financial_irregularity");
    assert.equal(rule.default_severity, "critical");
  });

  it("getRule returns undefined for unknown trigger", () => {
    assert.equal(getRule("nonexistent_trigger"), undefined);
  });

  it("getRulesByCategory filters correctly", () => {
    const policyRules = getRulesByCategory("policy_proximity");
    assert.ok(policyRules.length >= 6);
    assert.ok(policyRules.every((r) => r.category === "policy_proximity"));
  });

  it("most policy proximity rules do not generate questions (except dscr_below_policy_minimum)", () => {
    const policyRules = getRulesByCategory("policy_proximity");
    const noQuestion = policyRules.filter((r) => r.trigger_type !== "dscr_below_policy_minimum");
    assert.ok(noQuestion.every((r) => !r.generates_question));
    // dscr_below_policy_minimum is the only proximity rule that generates a question
    const dscrPolicy = policyRules.find((r) => r.trigger_type === "dscr_below_policy_minimum");
    assert.ok(dscrPolicy?.generates_question);
  });
});
