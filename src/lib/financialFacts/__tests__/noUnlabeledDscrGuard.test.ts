/**
 * SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1 — no unlabeled / mislabeled DSCR.
 *
 * Enforces that non-canonical coverage metrics are never rendered as a bare "DSCR": interest-only
 * coverage, proposed-loan-only coverage, and global DSCR each carry their own label. Source guards
 * (the render sites hit the DB / build JSX) lock the fixes against regression.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DSCR_DEFINITIONS } from "@/lib/financialFacts/dscrRegistry";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("exactly one registered metric is headline-DSCR eligible", () => {
  const headline = Object.values(DSCR_DEFINITIONS).filter((d) => d.isHeadlineDscr);
  assert.equal(headline.length, 1);
  assert.equal(headline[0].key, "DSCR");
});

test("no registered coverage metric other than canonical DSCR/GCF_DSCR/stressed uses a bare 'DSCR' label", () => {
  for (const d of Object.values(DSCR_DEFINITIONS)) {
    if (d.isProposedLoanOnly || d.key === "INTEREST_ONLY_COVERAGE") {
      assert.doesNotMatch(d.displayLabel, /\bDSCR\b/, `${d.key} must not be labeled DSCR`);
    }
  }
});

test("classic-spread interest-only coverage is NOT labeled DSCR", () => {
  const src = read("src/lib/classicSpread/classicSpreadRatios.ts");
  assert.doesNotMatch(src, /"DSCR \(Traditional\)"/, "the interest-only EBITDA row must not be called DSCR");
  assert.doesNotMatch(src, /"UCA Cash Flow DSCR"/, "the interest-only UCA row must not be called DSCR");
  assert.match(src, /Interest-Only Coverage \(EBITDA\)/);
  assert.match(src, /Interest-Only Coverage \(UCA Cash Flow\)/);
});

test("DebtServiceCoverageSection uses the registry labels and NCADS numerator (never proposed-ADS-as-DSCR / EBITDA-as-DSCR)", () => {
  const src = read("src/components/creditMemo/DebtServiceCoverageSection.tsx");
  assert.match(src, /dscrDisplayLabel\("DSCR"\)/, "headline uses the registry label");
  assert.match(src, /dscrDisplayLabel\("PROPOSED_LOAN_COVERAGE"\)/, "proposed-loan coverage is separately labeled");
  // The headline DSCR must come from CF_NCADS over TOTAL debt service — not EBITDA / proposed ADS.
  assert.match(src, /computeDscrLikeRatio\(ncads, totalDebtService\)/);
  assert.doesNotMatch(
    src,
    /latest\.ANNUAL_DEBT_SERVICE \?\? latest\.ANNUAL_DEBT_SERVICE_PROPOSED/,
    "must not silently substitute proposed debt service into the headline DSCR",
  );
  assert.doesNotMatch(src, /"Debt Service Coverage Ratio"/, "headline label comes from the registry, not a hardcoded string");
});

test("spread-output route never fabricates a DSCR from EBITDA", () => {
  const src = read("src/app/api/deals/[dealId]/spread-output/route.ts");
  assert.doesNotMatch(
    src,
    /cf_ncads_\$\{year\}`\]\)\s*\?\?\s*ebitda/,
    "per-year DSCR must not fall back to EBITDA as the numerator",
  );
});
