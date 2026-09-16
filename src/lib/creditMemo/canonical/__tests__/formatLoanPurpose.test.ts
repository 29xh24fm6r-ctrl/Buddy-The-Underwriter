import test from "node:test";
import assert from "node:assert/strict";
import { formatLoanPurpose } from "../formatLoanPurpose";

test("the live QA request's structured proceeds produce readable memo text", () => {
  const result = formatLoanPurpose(null, [
    { amount: 750000, category: "Equipment", description: "Five-axis machining center, tooling, installation" },
    { amount: 250000, category: "Working Capital", description: "Hiring, training, materials, and ramp reserve" },
  ]);
  assert.equal(result, "Equipment: Five-axis machining center, tooling, installation ($750,000.00); Working Capital: Hiring, training, materials, and ramp reserve ($250,000.00)");
  assert.ok(result.toLowerCase().includes("working capital"));
  assert.ok(!result.includes("[object Object]"));
});

test("explicit purpose and legacy prose retain their precedence", () => {
  assert.equal(formatLoanPurpose("  Equipment purchase  ", [{ category: "Other" }]), "Equipment purchase");
  assert.equal(formatLoanPurpose(null, "  Working capital  "), "Working capital");
  assert.equal(formatLoanPurpose("", ["Equipment", "Working capital"]), "Equipment; Working capital");
});

test("incomplete or malformed data never becomes invented purpose text", () => {
  for (const input of [null, undefined, 7, {}, [], [null, 3, {}, { amount: 100 }]]) {
    assert.equal(formatLoanPurpose(null, input), "Pending");
  }
  assert.equal(formatLoanPurpose({}, [{ description: "Tools", amount: "1250" }]), "Tools ($1,250.00)");
  assert.equal(formatLoanPurpose(null, [{ category: "Equipment", amount: "unknown" }]), "Equipment");
});
