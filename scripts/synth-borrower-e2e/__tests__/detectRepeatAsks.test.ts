/**
 * SPEC-M2 BEAT-METRICS-1 — detectRepeatAsks unit tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectRepeatAsks } from "../detectRepeatAsks";

describe("detectRepeatAsks", () => {
  it("returns empty when nothing is ever asked again after being satisfied", () => {
    const snapshots = [["business_name", "loan_amount"], ["loan_amount"], []];
    assert.deepEqual(detectRepeatAsks(snapshots), []);
  });

  it("detects a field asked again after it was satisfied", () => {
    // business_name: required, then satisfied (dropped), then required again.
    const snapshots = [["business_name", "loan_amount"], ["loan_amount"], ["business_name"]];
    assert.deepEqual(detectRepeatAsks(snapshots), ["business_name"]);
  });

  it("a field that stays required the whole time is never flagged", () => {
    const snapshots = [["ssn"], ["ssn"], ["ssn"]];
    assert.deepEqual(detectRepeatAsks(snapshots), []);
  });

  it("handles a field that disappears and reappears more than once", () => {
    const snapshots = [["a"], [], ["a"], [], ["a"]];
    assert.deepEqual(detectRepeatAsks(snapshots), ["a"]);
  });

  it("detects multiple distinct repeat-asked fields, sorted", () => {
    const snapshots = [
      ["zebra", "apple"],
      [],
      ["zebra"],
      [],
      ["apple"],
    ];
    assert.deepEqual(detectRepeatAsks(snapshots), ["apple", "zebra"]);
  });

  it("returns empty for an empty transcript", () => {
    assert.deepEqual(detectRepeatAsks([]), []);
  });

  it("a brand-new field appearing later (never asked before) is not a repeat", () => {
    const snapshots = [["a"], ["a", "b"], ["b"]];
    assert.deepEqual(detectRepeatAsks(snapshots), []);
  });
});
