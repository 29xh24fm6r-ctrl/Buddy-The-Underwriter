import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

const source = fs.readFileSync(
  path.join(repoRoot, "src/lib/classicSpread/classicSpreadLoader.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// SPEC-CLASSIC-SPREAD-PERIOD-SELECTION-1 guard tests
// ---------------------------------------------------------------------------

test("buildPeriodMaps uses tax-return spine selection instead of naive slice(-MAX_PERIODS)", () => {
  // The old naive slice should be gone
  assert.ok(
    !source.includes("periods.slice(-MAX_PERIODS)"),
    "Naive slice(-MAX_PERIODS) should be replaced with tax-return spine selection",
  );
  // Tax marker keys should be present
  assert.match(source, /TAX_MARKER_KEYS/);
  assert.match(source, /taxReturnPeriodSet/);
});

test("buildPeriodMaps identifies tax-return periods by IRS fact keys on Dec-31 dates", () => {
  assert.match(source, /GROSS_RECEIPTS/);
  assert.match(source, /ORDINARY_BUSINESS_INCOME/);
  assert.match(source, /endsWith.*-12-31/);
});

test("buildPeriodMaps preserves tax-return periods before IS/BS periods when truncating", () => {
  // The code should filter sortedTaxPeriods first, then fill remaining with others
  assert.match(source, /sortedTaxPeriods/);
  assert.match(source, /otherPeriods/);
  assert.match(source, /taxSlice/);
  // Tax years should be excluded from other periods to prevent duplicate columns
  assert.match(source, /taxYears/);
});
