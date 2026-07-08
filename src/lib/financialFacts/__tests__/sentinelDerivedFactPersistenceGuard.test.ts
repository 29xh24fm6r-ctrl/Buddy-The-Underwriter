/**
 * SPEC-CURRENT-STAGE-AUDIT-FIX-2 — sentinel-period derived-fact persistence guard.
 *
 * ROOT CAUSE this protects: intentional DEAL-LEVEL derived facts (CF_NCADS, CASH_FLOW_AVAILABLE,
 * GCF_GLOBAL_CASH_FLOW, GCF_DSCR, ANNUAL_DEBT_SERVICE) are stamped at the 1900-01-01 sentinel period.
 * writeFact.ts's MIN_VALID_PERIOD_DATE (1990-01-01) guard was built to reject EXTRACTION facts with
 * an unknown period, but it also silently rejected these intentional derived writes — the crude
 * fallback then permanently occupied the canonical key, defeating the "institutional waterfall wins"
 * contract and driving DSCR/coverage off the wrong value on every deal.
 *
 * These are source guards (the writers hit the DB, so they cannot be exercised as pure unit tests):
 * they assert the opt-in wiring stays in place so the silent-skip cannot regress.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("writeFact exposes the allowSentinelPeriod opt-in and only permits the EXACT sentinel", () => {
  const src = read("src/lib/financialFacts/writeFact.ts");
  assert.match(src, /allowSentinelPeriod\?:\s*boolean/, "opt-in param must exist");
  // Must gate on the exact sentinel, not blanket-allow every sub-minimum date.
  assert.match(
    src,
    /allowSentinelPeriod === true && periodEnd === SENTINEL_DATE/,
    "only the exact sentinel may bypass the guard when opted in",
  );
});

test("computeCashFlowWaterfallFacts opts into the sentinel period and fails loud on zero writes", () => {
  const src = read("src/lib/financialFacts/computeCashFlowWaterfallFacts.ts");
  assert.match(src, /allowSentinelPeriod:\s*true/, "waterfall NCADS write must opt in");
  assert.match(src, /reason:\s*"persist_failed"/, "must fail loud when nothing persisted");
});

test("persistGlobalCashFlow opts into the sentinel period for GCF facts", () => {
  const src = read("src/lib/financialIntelligence/persistGlobalCashFlow.ts");
  assert.match(src, /allowSentinelPeriod:\s*true/, "GCF writes must opt in");
});

test("renderSpread persistGcfComputedFacts opts in and counts rejections as errors", () => {
  const src = read("src/lib/financialSpreads/renderSpread.ts");
  assert.match(src, /allowSentinelPeriod:\s*true/, "GCF persisted-fact write must opt in");
  // The guarded writer returns {ok:false} (it does NOT throw) on rejection — must be treated as error.
  assert.match(src, /if\s*\(res\.ok\)/, "must branch on the writer's ok flag, not assume success");
});

test("materializeDebtServiceFact opts into the sentinel period for ADS", () => {
  const src = read("src/lib/structuralPricing/materializeDebtServiceFact.ts");
  assert.match(src, /allowSentinelPeriod:\s*true/, "ADS write must opt in");
});

test("backfillFromSpreads derives a valid period from provenance and counts only persisted rows", () => {
  const src = read("src/lib/financialFacts/backfillFromSpreads.ts");
  // Period is resolved from the write's provenance.as_of_date rather than defaulting to the sentinel.
  assert.match(src, /as_of_date/, "must resolve period from provenance.as_of_date");
  assert.match(src, /MIN_VALID_PERIOD_DATE/, "must validate the resolved period");
  // Skips are not counted as writes; a genuine all-failed batch is reported ok:false.
  assert.match(src, /attempted > 0 && factsWritten === 0/, "honest all-failed accounting");
});
