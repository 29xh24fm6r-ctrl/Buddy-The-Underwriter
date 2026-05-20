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
// SPEC-CLASSIC-SPREAD-PERIOD-POLICY-1 guard tests
// ---------------------------------------------------------------------------

test("MAX_PERIODS is 5 (landscape PDF fits 5 columns)", () => {
  assert.match(source, /MAX_PERIODS\s*=\s*5/);
});

test("buildPeriodMaps identifies tax-return periods by IRS fact keys on Dec-31 dates", () => {
  assert.match(source, /TAX_MARKER_KEYS/);
  assert.match(source, /GROSS_RECEIPTS/);
  assert.match(source, /ORDINARY_BUSINESS_INCOME/);
  assert.match(source, /endsWith.*-12-31/);
});

test("period policy: non-tax (IS/BS) periods included first, tax fills remaining slots", () => {
  // nonTaxPeriods comes first in the fill logic
  assert.match(source, /nonTaxPeriods/);
  assert.match(source, /taxPeriods/);
  // remaining = MAX_PERIODS - nonTaxPeriods.length
  assert.match(source, /MAX_PERIODS\s*-\s*nonTaxPeriods\.length/);
  // taxToInclude uses slice(-remaining) to pick most recent tax years
  assert.match(source, /taxToInclude\s*=\s*taxPeriods\.slice\(-remaining\)/);
});

test("no naive slice(-MAX_PERIODS) remains as the sole truncation strategy", () => {
  // The old "periods.slice(-MAX_PERIODS)" as sole strategy should be gone.
  // A final safety slice may exist but the primary logic must be the policy above.
  assert.ok(
    !source.includes("periods = Array.from(periodSet).sort();\n  if (periods.length > MAX_PERIODS)"),
    "Old naive period-truncation pattern should be replaced",
  );
});
