/**
 * SPEC-M4 FIX-CARDS-1 — gapKeySetChanged unit tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gapKeySetChanged } from "../dedupeDocRequestRound";

test("identical sets (same order) → unchanged", () => {
  assert.equal(gapKeySetChanged(["a", "b"], ["a", "b"]), false);
});

test("identical sets (different order) → unchanged", () => {
  assert.equal(gapKeySetChanged(["b", "a"], ["a", "b"]), false);
});

test("different lengths → changed", () => {
  assert.equal(gapKeySetChanged(["a", "b"], ["a"]), true);
});

test("same length, different members → changed", () => {
  assert.equal(gapKeySetChanged(["a", "c"], ["a", "b"]), true);
});

test("both empty → unchanged", () => {
  assert.equal(gapKeySetChanged([], []), false);
});

test("empty vs non-empty → changed", () => {
  assert.equal(gapKeySetChanged(["a"], []), true);
});
