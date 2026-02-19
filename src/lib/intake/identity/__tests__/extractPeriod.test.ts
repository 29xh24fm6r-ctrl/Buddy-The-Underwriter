/**
 * extractPeriod — Unit Tests
 *
 * ~20 test cases covering all pattern priorities, multi-year detection,
 * fallbacks, and critical invariants.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { extractPeriod } from "../extractPeriod";

// ---------------------------------------------------------------------------
// 1. Annual: "For the year ended December 31, 2024"
// ---------------------------------------------------------------------------
test("Pattern 2: for the year ended December 31, 2024", () => {
  const r = extractPeriod("For the year ended December 31, 2024");
  assert.equal(r.taxYear, 2024);
  assert.equal(r.statementType, "annual");
  assert.equal(r.periodEnd, "2024-12-31");
  assert.ok(r.taxYearConfidence >= 0.90, `confidence ${r.taxYearConfidence} < 0.90`);
});

// ---------------------------------------------------------------------------
// 2. Calendar year
// ---------------------------------------------------------------------------
test("Pattern 1: for calendar year 2023", () => {
  const r = extractPeriod("For calendar year 2023");
  assert.equal(r.taxYear, 2023);
  assert.equal(r.statementType, "annual");
  assert.ok(r.taxYearConfidence >= 0.95, `confidence ${r.taxYearConfidence} < 0.95`);
});

// ---------------------------------------------------------------------------
// 3. Tax year
// ---------------------------------------------------------------------------
test("Pattern 1: for tax year 2023", () => {
  const r = extractPeriod("For tax year 2023");
  assert.equal(r.taxYear, 2023);
  assert.equal(r.statementType, "annual");
  assert.ok(r.taxYearConfidence >= 0.95, `confidence ${r.taxYearConfidence} < 0.95`);
});

// ---------------------------------------------------------------------------
// 4. YTD
// ---------------------------------------------------------------------------
test("Pattern 8+4: Year-to-Date as of September 30, 2025", () => {
  const r = extractPeriod("Year-to-Date as of September 30, 2025");
  assert.equal(r.statementType, "ytd");
});

// ---------------------------------------------------------------------------
// 5. Monthly
// ---------------------------------------------------------------------------
test("Pattern 6: for the month ending March 31, 2025", () => {
  const r = extractPeriod("For the month ending March 31, 2025");
  assert.equal(r.statementType, "monthly");
  assert.equal(r.periodEnd, "2025-03-31");
});

// ---------------------------------------------------------------------------
// 6. Quarterly
// ---------------------------------------------------------------------------
test("Pattern 7: for the quarter ending June 30, 2024", () => {
  const r = extractPeriod("For the quarter ending June 30, 2024");
  assert.equal(r.statementType, "quarterly");
  assert.equal(r.periodEnd, "2024-06-30");
});

// ---------------------------------------------------------------------------
// 7. TTM — never "t12"
// ---------------------------------------------------------------------------
test("Pattern 9: trailing 12 months ending December 31, 2024", () => {
  const r = extractPeriod("Trailing 12 months ending December 31, 2024");
  assert.equal(r.statementType, "ttm");
  assert.notEqual(r.statementType, "t12" as never);
});

// ---------------------------------------------------------------------------
// 8. Multi-year: explicit patterns
// ---------------------------------------------------------------------------
test("Multi-year: two calendar year patterns produce multiYear=true", () => {
  const r = extractPeriod(
    "For calendar year 2023\nFor calendar year 2024",
  );
  assert.equal(r.multiYear, true);
});

// ---------------------------------------------------------------------------
// 9. Multi-year comparative: bare years do NOT trigger multiYear
// ---------------------------------------------------------------------------
test("Multi-year: bare years in text do NOT set multiYear", () => {
  const r = extractPeriod(
    "Comparative Financial Statements 2022 2023 2024",
  );
  assert.equal(r.multiYear, false);
});

// ---------------------------------------------------------------------------
// 10. Tax return beginning/ending
// ---------------------------------------------------------------------------
test("Pattern 3: tax year beginning 2023 and ending 2024", () => {
  const r = extractPeriod("Tax year beginning 2023 and ending 2024");
  assert.equal(r.taxYear, 2023);
  assert.ok(r.taxYearConfidence >= 0.90, `confidence ${r.taxYearConfidence} < 0.90`);
  assert.equal(r.statementType, "annual");
  assert.equal(r.multiYear, true);
});

// ---------------------------------------------------------------------------
// 11. Empty text
// ---------------------------------------------------------------------------
test("Fallback: empty text → null taxYear, 0 confidence", () => {
  const r = extractPeriod("");
  assert.equal(r.taxYear, null);
  assert.equal(r.taxYearConfidence, 0);
  assert.equal(r.multiYear, false);
  assert.equal(r.evidence.length, 0);
});

// ---------------------------------------------------------------------------
// 12. Filename year only
// ---------------------------------------------------------------------------
test("Fallback: filename year when text has no date patterns", () => {
  const r = extractPeriod("Some text with no dates", "BTR_2023.pdf");
  assert.equal(r.taxYear, 2023);
  assert.ok(
    Math.abs(r.taxYearConfidence - 0.60) < 0.01,
    `confidence ${r.taxYearConfidence} !== 0.60`,
  );
});

// ---------------------------------------------------------------------------
// 13. Weak text year
// ---------------------------------------------------------------------------
test("Fallback: weak text year picks most recent 4-digit year", () => {
  const r = extractPeriod("Some document about fiscal planning in 2024");
  assert.equal(r.taxYear, 2024);
  assert.ok(
    Math.abs(r.taxYearConfidence - 0.50) < 0.01,
    `confidence ${r.taxYearConfidence} !== 0.50`,
  );
});

// ---------------------------------------------------------------------------
// 14. Balance sheet "as of"
// ---------------------------------------------------------------------------
test("Pattern 4: as of June 30, 2025", () => {
  const r = extractPeriod("Balance Sheet As of June 30, 2025");
  assert.equal(r.periodEnd, "2025-06-30");
  assert.equal(r.taxYear, 2025);
  assert.equal(r.statementType, null); // as-of doesn't determine type
});

// ---------------------------------------------------------------------------
// 15. Period range → annual
// ---------------------------------------------------------------------------
test("Pattern 5: for the period January 1, 2024 to December 31, 2024", () => {
  const r = extractPeriod(
    "For the period January 1, 2024 to December 31, 2024",
  );
  assert.equal(r.periodStart, "2024-01-01");
  assert.equal(r.periodEnd, "2024-12-31");
  assert.equal(r.statementType, "annual");
});

// ---------------------------------------------------------------------------
// 16. Period range → monthly
// ---------------------------------------------------------------------------
test("Pattern 5: for the period March 1 to March 31, 2025 → monthly", () => {
  const r = extractPeriod(
    "For the period March 1, 2025 to March 31, 2025",
  );
  assert.equal(r.statementType, "monthly");
});

// ---------------------------------------------------------------------------
// 17. Evidence populated
// ---------------------------------------------------------------------------
test("Evidence is populated for matched patterns", () => {
  const r = extractPeriod("For the year ended December 31, 2024");
  assert.ok(r.evidence.length > 0, "evidence should not be empty");
  assert.ok(
    r.evidence.some((e) => e.signal === "for_year_ended"),
    "should have for_year_ended signal",
  );
});

// ---------------------------------------------------------------------------
// 18. No T12 as statementType — critical invariant
// ---------------------------------------------------------------------------
test("StatementType is never 't12'", () => {
  const inputs = [
    "Trailing 12 months ending December 31, 2024",
    "TTM report for the period",
    "Trailing twelve months ended June 30, 2024",
    "T12 Operating Statement",
  ];
  for (const txt of inputs) {
    const r = extractPeriod(txt);
    assert.notEqual(
      r.statementType,
      "t12" as never,
      `statementType should not be "t12" for: ${txt}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 19. Date format MM/DD/YYYY
// ---------------------------------------------------------------------------
test("Pattern 2b: for the year ended 12/31/2023", () => {
  const r = extractPeriod("For the year ended 12/31/2023");
  assert.equal(r.periodEnd, "2023-12-31");
  assert.equal(r.taxYear, 2023);
  assert.equal(r.statementType, "annual");
});

// ---------------------------------------------------------------------------
// 20. Fiscal year end not December 31
// ---------------------------------------------------------------------------
test("Pattern 2: fiscal year ended June 30, 2024", () => {
  const r = extractPeriod("For the year ended June 30, 2024");
  assert.equal(r.periodEnd, "2024-06-30");
  assert.equal(r.taxYear, 2024);
  assert.equal(r.statementType, "annual");
});
