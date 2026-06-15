import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyCell, isTrueZero } from "../cellState";

/** SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #6 — true zero vs missing vs blocked. */

describe("classifyCell", () => {
  it("a reported zero is true_zero (net income, allowance, debt all = 0)", () => {
    assert.equal(classifyCell({ value: 0, present: true }), "true_zero"); // true-zero net income
    assert.equal(classifyCell({ value: 0 }), "true_zero"); // present defaults from non-null value
    assert.equal(isTrueZero(classifyCell({ value: 0 })), true);
  });

  it("a null value is missing (not zero)", () => {
    assert.equal(classifyCell({ value: null }), "missing");
    assert.equal(isTrueZero(classifyCell({ value: null })), false);
  });

  it("a suppressed value is blocked (even if non-null)", () => {
    assert.equal(classifyCell({ value: 1000, blocked: true }), "blocked");
    assert.equal(classifyCell({ value: 0, blocked: true }), "blocked");
  });

  it("a fallback/derived value is derived; a direct source value is direct", () => {
    assert.equal(classifyCell({ value: 500, derived: true }), "derived");
    assert.equal(classifyCell({ value: 500 }), "direct");
  });
});
