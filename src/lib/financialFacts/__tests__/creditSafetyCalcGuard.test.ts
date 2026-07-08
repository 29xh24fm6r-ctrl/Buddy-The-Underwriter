/**
 * SPEC-CURRENT-STAGE-AUDIT-FIX-2 — credit-safety calculation & integrity guards.
 *
 * Source guards for the Tier-3/6/8 fixes whose code paths hit the DB (so they cannot be exercised as
 * pure unit tests). Each asserts the fix stays in place so the lender-dangerous behavior cannot regress.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("multi-OPCO EBITDA: deal-level inputs are consumed only ONCE (no N× duplication)", () => {
  const src = read("src/lib/financialFacts/computeBusinessEbitdaFacts.ts");
  // Prefers this entity's own facts, then falls back to deal-level facts a single time.
  assert.match(src, /\.eq\("owner_entity_id", entityId\)/, "must prefer entity-scoped facts");
  assert.match(src, /dealLevelInputsConsumed/, "deal-level fallback must be consumed only once");
});

test("global cash flow: depreciation not re-added onto an already-adjusted base (no double-count)", () => {
  const src = read("src/lib/financialIntelligence/persistGlobalCashFlow.ts");
  // The block sourcing netIncome from NOI/EBITDA/CASH_FLOW_AVAILABLE must set depreciation to null.
  assert.match(src, /const depreciation = null;/, "adjusted base must not re-add depreciation");
  // The fallback must only add depreciation when the base is RAW net income.
  assert.match(src, /netIncomeIsRaw\s*\n?\s*\?\s*findFact\(\{ factType: "TAX_RETURN", factKey: "DEPRECIATION" \}\)/, "raw-net-income-only D&A add-back");
});

test("global cash flow: GROSS_RECEIPTS is NOT used as a net-income fallback (revenue is not profit)", () => {
  const src = read("src/lib/financialIntelligence/persistGlobalCashFlow.ts");
  assert.doesNotMatch(
    src,
    /factKey:\s*"GROSS_RECEIPTS"/,
    "gross receipts (top-line revenue) must never stand in for net income",
  );
});

test("engineAuthority: the authoritative deal_spreads write is AWAITED (not fire-and-forget)", () => {
  const src = read("src/lib/modelEngine/engineAuthority.ts");
  assert.match(
    src,
    /await \(sb as any\)\s*\n?\s*\.from\("deal_spreads"\)/,
    "authoritative deal_spreads upsert must be awaited",
  );
  assert.doesNotMatch(
    src,
    /void \(sb as any\)\s*\n?\s*\.from\("deal_spreads"\)/,
    "must not be a fire-and-forget void write",
  );
});

test("combined/generate route: requires auth and returns 501 (no fabricated data)", () => {
  const src = read("src/app/api/deals/[dealId]/spreads/combined/generate/route.ts");
  assert.match(src, /requireDealCockpitAccess/, "must require deal cockpit access");
  assert.match(src, /501/, "must return 501 not_implemented");
  // The fabrication came from mocked entity periods aggregated via aggregateEntityFinancials.
  // (Math.random still appears in the doc comment explaining the old behavior — check real usage.)
  assert.doesNotMatch(src, /mockPeriods/, "must not build mocked entity periods");
  assert.doesNotMatch(src, /aggregateEntityFinancials\(/, "must not aggregate fabricated financials");
});
