import { test } from "node:test";
import assert from "node:assert/strict";
import { determineGuaranteeType } from "@/lib/ownership/rules";

test("determineGuaranteeType: 25% ownership -> unconditional", () => {
  assert.equal(determineGuaranteeType(25), "unconditional");
});

test("determineGuaranteeType: exactly 20% -> unconditional (threshold is inclusive)", () => {
  assert.equal(determineGuaranteeType(20), "unconditional");
});

test("determineGuaranteeType: 10% ownership -> limited", () => {
  assert.equal(determineGuaranteeType(10), "limited");
});

test("determineGuaranteeType: 0% ownership -> null (no guarantee required)", () => {
  assert.equal(determineGuaranteeType(0), null);
});

test("determineGuaranteeType: null/undefined ownership -> null", () => {
  assert.equal(determineGuaranteeType(null), null);
  assert.equal(determineGuaranteeType(undefined), null);
});
