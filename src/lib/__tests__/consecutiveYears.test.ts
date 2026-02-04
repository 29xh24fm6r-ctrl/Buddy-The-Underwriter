import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateConsecutiveYears,
  formatYearRange,
} from "@/lib/readiness/consecutiveYears";

// ========================================
// Basic happy paths
// ========================================

test("3 consecutive years satisfies 3-year requirement", () => {
  const result = evaluateConsecutiveYears([2022, 2023, 2024], 3, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2022, end: 2024, years: [2022, 2023, 2024] });
  assert.equal(result.reason, undefined);
});

test("3 consecutive years with minMostRecentYear met", () => {
  const result = evaluateConsecutiveYears([2023, 2024, 2025], 3, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2023, end: 2025, years: [2023, 2024, 2025] });
});

test("exactly 2 consecutive years satisfies 2-year requirement", () => {
  const result = evaluateConsecutiveYears([2023, 2024], 2, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2023, end: 2024, years: [2023, 2024] });
});

// ========================================
// Deduplication
// ========================================

test("duplicates are ignored — [2022,2022,2023,2024] satisfies 3-year", () => {
  const result = evaluateConsecutiveYears([2022, 2022, 2023, 2024], 3, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2022, end: 2024, years: [2022, 2023, 2024] });
});

// ========================================
// Run selection: picks most recent qualifying run
// ========================================

test("multiple qualifying runs — picks the most recent", () => {
  // Two runs: 2020-2022 and 2024-2026
  const result = evaluateConsecutiveYears([2020, 2021, 2022, 2024, 2025, 2026], 3, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2024, end: 2026, years: [2024, 2025, 2026] });
});

test("long consecutive run trims to most recent N years", () => {
  // Run of 5: 2020-2024, should trim to 2022-2024
  const result = evaluateConsecutiveYears([2020, 2021, 2022, 2023, 2024], 3, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2022, end: 2024, years: [2022, 2023, 2024] });
});

// ========================================
// Failures: not enough years
// ========================================

test("empty years array fails", () => {
  const result = evaluateConsecutiveYears([], 3, 2024);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Need 3 more year(s)");
});

test("1 year when 3 required fails", () => {
  const result = evaluateConsecutiveYears([2024], 3, 2024);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Need 2 more years");
});

test("2 years when 3 required fails", () => {
  const result = evaluateConsecutiveYears([2023, 2024], 3, 2024);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Need 1 more year");
});

// ========================================
// Failures: gap in years
// ========================================

test("non-consecutive years [2022, 2024, 2025] fails with gap message", () => {
  const result = evaluateConsecutiveYears([2022, 2024, 2025], 3, 2024);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("Gap between 2022 and 2024"));
});

test("3 non-consecutive years [2020, 2022, 2024] fails", () => {
  const result = evaluateConsecutiveYears([2020, 2022, 2024], 3, 2024);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("Gap"));
});

// ========================================
// Failures: too stale (recency check)
// ========================================

test("old consecutive run fails recency check", () => {
  const result = evaluateConsecutiveYears([2021, 2022, 2023], 3, 2025);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("Most recent year on file is 2023"));
  assert.ok(result.reason?.includes("need 2025+"));
  // Should still provide the run for UI display
  assert.deepEqual(result.run, { start: 2021, end: 2023, years: [2021, 2022, 2023] });
});

test("consecutive run ending at minMostRecentYear passes", () => {
  const result = evaluateConsecutiveYears([2023, 2024, 2025], 3, 2025);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2023, end: 2025, years: [2023, 2024, 2025] });
});

test("consecutive run ending one year above minMostRecentYear passes", () => {
  const result = evaluateConsecutiveYears([2023, 2024, 2025], 3, 2024);
  assert.equal(result.ok, true);
});

// ========================================
// Edge cases
// ========================================

test("single year satisfies 1-year requirement with recency", () => {
  const result = evaluateConsecutiveYears([2024], 1, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2024, end: 2024, years: [2024] });
});

test("NaN and non-finite values are filtered out", () => {
  const result = evaluateConsecutiveYears([2022, NaN, 2023, Infinity, 2024], 3, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2022, end: 2024, years: [2022, 2023, 2024] });
});

test("unordered input is sorted correctly", () => {
  const result = evaluateConsecutiveYears([2024, 2022, 2023], 3, 2024);
  assert.equal(result.ok, true);
  assert.deepEqual(result.run, { start: 2022, end: 2024, years: [2022, 2023, 2024] });
});

// ========================================
// formatYearRange
// ========================================

test("formatYearRange with different start and end", () => {
  const result = formatYearRange(2022, 2024);
  assert.equal(result, "2022\u20132024");
});

test("formatYearRange with same start and end", () => {
  const result = formatYearRange(2024, 2024);
  assert.equal(result, "2024");
});
