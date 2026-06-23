import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

function readSource(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

const renderSpread = readSource("src/lib/financialSpreads/renderSpread.ts");
const renderStandard = readSource(
  "src/lib/financialSpreads/standard/renderStandardSpread.ts",
);

// ---------------------------------------------------------------------------
// SPEC-SPREAD-SUPERSEDED-FILTER-1 guard tests
// ---------------------------------------------------------------------------

test("renderSpread query filters is_superseded = false", () => {
  // The facts query must include .eq("is_superseded", false)
  const queryBlock = renderSpread.slice(
    renderSpread.indexOf("deal_financial_facts"),
    renderSpread.indexOf("deal_financial_facts") + 300,
  );
  assert.match(
    queryBlock,
    /\.eq\(["']is_superseded["'],\s*false\)/,
    "renderSpread must filter out superseded facts",
  );
});

test("detectPeriods identifies BUSINESS_TAX_RETURN source_canonical_type as tax spine", () => {
  assert.match(
    renderStandard,
    /BUSINESS_TAX_RETURN/,
    "BUSINESS_TAX_RETURN must be in FULL_YEAR_SOURCE_TYPES",
  );
  assert.match(
    renderStandard,
    /sourceTypesByPeriod/,
    "detectPeriods must track source_canonical_type per period",
  );
  // The tax return filter must check sourceTypes
  const filterBlock = renderStandard.slice(
    renderStandard.indexOf("taxReturnPeriods = allPeriodEnds.filter"),
    renderStandard.indexOf("taxReturnPeriods = allPeriodEnds.filter") + 400,
  );
  assert.match(filterBlock, /sourceTypes/);
  assert.match(filterBlock, /FULL_YEAR_SOURCE_TYPES/);
});

test("detectPeriods identifies PERSONAL_TAX_RETURN as tax spine", () => {
  assert.match(
    renderStandard,
    /PERSONAL_TAX_RETURN/,
    "PERSONAL_TAX_RETURN must be in FULL_YEAR_SOURCE_TYPES",
  );
});
