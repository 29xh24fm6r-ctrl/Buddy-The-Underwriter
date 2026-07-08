/**
 * SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1 — DSCR registry invariants.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DSCR_DEFINITIONS,
  CANONICAL_DSCR_KEY,
  getDscrDefinition,
  canonicalDscrDefinition,
  isHeadlineDscr,
  dscrDisplayLabel,
  computeDscrLikeRatio,
} from "@/lib/financialFacts/dscrRegistry";

test("exactly ONE metric may be rendered as the headline DSCR", () => {
  const headline = Object.values(DSCR_DEFINITIONS).filter((d) => d.isHeadlineDscr);
  assert.equal(headline.length, 1, "exactly one headline DSCR");
  assert.equal(headline[0].key, CANONICAL_DSCR_KEY);
});

test("canonical DSCR = CF_NCADS / ANNUAL_DEBT_SERVICE", () => {
  const d = canonicalDscrDefinition();
  assert.equal(d.numeratorKey, "CF_NCADS");
  assert.equal(d.denominatorKey, "ANNUAL_DEBT_SERVICE");
  assert.equal(d.displayLabel, "DSCR");
  assert.equal(d.isHeadlineDscr, true);
  assert.equal(d.isCovenantEligible, true);
});

test("GCF DSCR is global, uses the global cash flow numerator, and is NOT headline", () => {
  const d = getDscrDefinition("GCF_DSCR")!;
  assert.equal(d.numeratorKey, "GCF_GLOBAL_CASH_FLOW");
  assert.equal(d.denominatorKey, "ANNUAL_DEBT_SERVICE");
  assert.equal(d.isGlobalSponsorSupport, true);
  assert.equal(d.isHeadlineDscr, false);
  assert.match(d.displayLabel, /Global/);
});

test("proposed-loan coverage is proposed-only, NOT headline, NOT covenant-eligible, and not called DSCR", () => {
  const d = getDscrDefinition("PROPOSED_LOAN_COVERAGE")!;
  assert.equal(d.isProposedLoanOnly, true);
  assert.equal(d.isHeadlineDscr, false);
  assert.equal(d.isCovenantEligible, false);
  assert.equal(d.denominatorKey, "ANNUAL_DEBT_SERVICE_PROPOSED");
  assert.doesNotMatch(d.displayLabel, /\bDSCR\b/);
});

test("interest-only coverage exists, is NOT headline, and its label never says DSCR", () => {
  const d = getDscrDefinition("INTEREST_ONLY_COVERAGE")!;
  assert.equal(d.isHeadlineDscr, false);
  assert.match(d.displayLabel, /Interest-Only Coverage/);
  assert.doesNotMatch(d.displayLabel, /\bDSCR\b/);
});

test("historical actual DSCR uses ACTUAL (existing) debt service, labeled historical", () => {
  const d = getDscrDefinition("HISTORICAL_ACTUAL_DSCR")!;
  assert.equal(d.temporalKind, "historical");
  assert.equal(d.denominatorKey, "ANNUAL_DEBT_SERVICE_EXISTING");
  assert.match(d.displayLabel, /Historical Actual DSCR/);
  assert.equal(d.isHeadlineDscr, false);
});

test("stressed DSCR is labeled stressed and is not headline", () => {
  const d = getDscrDefinition("DSCR_STRESSED_300BPS")!;
  assert.equal(d.temporalKind, "stressed");
  assert.equal(d.isHeadlineDscr, false);
  assert.match(d.displayLabel, /Stressed/);
});

test("isHeadlineDscr only true for the canonical key", () => {
  for (const key of Object.keys(DSCR_DEFINITIONS)) {
    assert.equal(isHeadlineDscr(key), key === CANONICAL_DSCR_KEY, key);
  }
  assert.equal(isHeadlineDscr("UNKNOWN"), false);
});

test("dscrDisplayLabel is fail-visible for unknown keys (never a false DSCR)", () => {
  assert.equal(dscrDisplayLabel("SOMETHING_ELSE"), "SOMETHING_ELSE");
});

test("computeDscrLikeRatio is credit-safe: null on missing / non-positive denominator", () => {
  assert.equal(computeDscrLikeRatio(150, 100), 1.5);
  assert.equal(computeDscrLikeRatio(null, 100), null);
  assert.equal(computeDscrLikeRatio(150, null), null);
  assert.equal(computeDscrLikeRatio(150, 0), null, "zero debt service is not infinite coverage");
  assert.equal(computeDscrLikeRatio(150, -5), null, "negative denominator is meaningless");
});
