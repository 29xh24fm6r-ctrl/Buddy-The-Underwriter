import test from "node:test";
import assert from "node:assert/strict";
import { shouldPersistChapterMove } from "../chapterNavigation";

/**
 * Regression tests for "Resolve now rewinds the borrower".
 *
 * The review screen's Resolve-now buttons jump backward (chapter 3 for
 * Ownership & Identity, 4 for Financials). Persisting those as the resume
 * pointer overwrote a borrower on review at chapter 5 with chapter 3.
 */

test("Resolve now from review does not move the resume pointer", () => {
  // Ownership & Identity — the exact click in the report.
  assert.equal(
    shouldPersistChapterMove({ from: 5, to: 3, hasData: false }),
    false,
    "a backward deep-link must not overwrite current_chapter",
  );
  // Financials.
  assert.equal(shouldPersistChapterMove({ from: 5, to: 4, hasData: false }), false);
  // Financing scope, the furthest jump back.
  assert.equal(shouldPersistChapterMove({ from: 5, to: 1, hasData: false }), false);
});

test("forward moves still persist", () => {
  for (const [from, to] of [[1, 2], [2, 3], [3, 4], [4, 5]]) {
    assert.equal(
      shouldPersistChapterMove({ from, to, hasData: true }),
      true,
      `advancing ${from} -> ${to} must save before advancing`,
    );
  }
  // Forward with no payload still advances the pointer.
  assert.equal(shouldPersistChapterMove({ from: 2, to: 3, hasData: false }), true);
});

test("a backward move carrying data still persists", () => {
  // The borrower went back to fix chapter 3 and pressed Continue: the answers
  // must be written even though the destination is behind where they were.
  assert.equal(shouldPersistChapterMove({ from: 5, to: 4, hasData: true }), true);
});

test("staying on the same chapter persists", () => {
  // A re-save of the current chapter is a normal save, not a rewind.
  assert.equal(shouldPersistChapterMove({ from: 3, to: 3, hasData: false }), true);
});
