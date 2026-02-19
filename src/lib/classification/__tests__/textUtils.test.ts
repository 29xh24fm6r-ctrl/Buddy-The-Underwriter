import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTaxYear,
  extractFormNumbers,
  extractDetectedYears,
} from "../textUtils";

// ─── extractTaxYear ─────────────────────────────────────────────────────────

test("extractTaxYear: explicit 'Tax Year 2023'", () => {
  assert.equal(extractTaxYear("Tax Year 2023\nForm 1040"), 2023);
});

test("extractTaxYear: 'For the Year Ended 2022'", () => {
  assert.equal(extractTaxYear("For the Year Ended 2022\nSchedule C"), 2022);
});

test("extractTaxYear: calendar year 'December 31, 2024'", () => {
  assert.equal(extractTaxYear("Report ending December 31, 2024"), 2024);
});

test("extractTaxYear: calendar year '12/31/2023'", () => {
  assert.equal(extractTaxYear("Period: 01/01/2023 - 12/31/2023"), 2023);
});

test("extractTaxYear: fallback to most recent year in head", () => {
  assert.equal(extractTaxYear("Filed in 2022 for 2021 income"), 2022);
});

test("extractTaxYear: null when no years found", () => {
  assert.equal(extractTaxYear("No dates in this document"), null);
});

// ─── extractFormNumbers ─────────────────────────────────────────────────────

test("extractFormNumbers: detects Form 1040 + Schedule C", () => {
  const forms = extractFormNumbers("Form 1040\nSchedule C attached");
  assert.ok(forms.includes("1040"));
  assert.ok(forms.includes("Schedule C"));
});

test("extractFormNumbers: empty for non-IRS document", () => {
  const forms = extractFormNumbers("This is a rent roll with tenant data");
  assert.equal(forms.length, 0);
});

// ─── extractDetectedYears ───────────────────────────────────────────────────

test("extractDetectedYears: finds multiple years descending", () => {
  const years = extractDetectedYears("Revenue 2022: $100k, Revenue 2023: $120k, Revenue 2024: $140k");
  assert.deepEqual(years, [2024, 2023, 2022]);
});

test("extractDetectedYears: deduplicates repeated years", () => {
  const years = extractDetectedYears("2023 income 2023 expenses 2023 total");
  assert.deepEqual(years, [2023]);
});

test("extractDetectedYears: empty for no years", () => {
  const years = extractDetectedYears("No numeric data here");
  assert.deepEqual(years, []);
});
