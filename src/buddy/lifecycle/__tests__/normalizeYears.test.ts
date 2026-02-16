import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeYearArray } from "../normalizeYears";

// ─── Non-array inputs → [] ──────────────────────────────────────────────────

describe("normalizeYearArray — non-array inputs", () => {
  test("null → []", () => {
    assert.deepEqual(normalizeYearArray(null), []);
  });

  test("undefined → []", () => {
    assert.deepEqual(normalizeYearArray(undefined), []);
  });

  test("object {} → []", () => {
    assert.deepEqual(normalizeYearArray({}), []);
  });

  test("bare string '2024' → []", () => {
    assert.deepEqual(normalizeYearArray("2024"), []);
  });

  test("number 2024 → []", () => {
    assert.deepEqual(normalizeYearArray(2024), []);
  });

  test("boolean true → []", () => {
    assert.deepEqual(normalizeYearArray(true), []);
  });
});

// ─── Array inputs — coerce, dedupe, sort, filter ────────────────────────────

describe("normalizeYearArray — array inputs", () => {
  test("empty array → []", () => {
    assert.deepEqual(normalizeYearArray([]), []);
  });

  test("clean number array passes through sorted", () => {
    assert.deepEqual(normalizeYearArray([2024, 2022, 2023]), [2022, 2023, 2024]);
  });

  test("string years coerced to integers", () => {
    assert.deepEqual(normalizeYearArray(["2024", "2023"]), [2023, 2024]);
  });

  test("string years with whitespace coerced", () => {
    assert.deepEqual(normalizeYearArray([" 2024 ", "\n2023\t"]), [2023, 2024]);
  });

  test("mixed strings + numbers, deduped and sorted", () => {
    assert.deepEqual(
      normalizeYearArray(["2024", 2023, 2023, "nope"]),
      [2023, 2024],
    );
  });

  test("non-parseable strings dropped", () => {
    assert.deepEqual(normalizeYearArray(["abc", "def", ""]), []);
  });

  test("NaN, Infinity, fractional dropped", () => {
    assert.deepEqual(normalizeYearArray([NaN, Infinity, -Infinity, 2023.5, 2024]), [2024]);
  });

  test("nested objects and booleans dropped", () => {
    assert.deepEqual(normalizeYearArray([{}, true, null, 2022]), [2022]);
  });

  test("duplicates collapsed", () => {
    assert.deepEqual(normalizeYearArray([2023, 2023, 2023]), [2023]);
  });

  test("already sorted array unchanged", () => {
    assert.deepEqual(normalizeYearArray([2021, 2022, 2023]), [2021, 2022, 2023]);
  });
});
