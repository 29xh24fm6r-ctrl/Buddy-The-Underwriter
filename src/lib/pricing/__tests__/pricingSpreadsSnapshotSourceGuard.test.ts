/**
 * SPEC-PRICING-SPREADS-SNAPSHOT-SOURCE-OF-TRUTH-1 — CI Guard Tests
 *
 * Locks the canonical handoff:
 *   spread-output success → financial_snapshots row → lifecycle gate → pricing scenarios
 *
 * Guards:
 * 1. spread-output route persists financial snapshot after building report
 * 2. deriveLifecycleState financialSnapshotExists reads from financial_snapshots
 * 3. generatePricingScenarios checks financial_snapshots (422 if missing)
 * 4. pricing-assumptions POST seeds from structural pricing + loan request (not hardcoded SOFR)
 * 5. pricing-assumptions GET repairs stale invalid inputs from structural pricing
 * 6. spread-output cannot silently succeed without snapshot persistence attempt
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const SPREAD_OUTPUT = read("src/app/api/deals/[dealId]/spread-output/route.ts");
const DERIVE_LIFECYCLE = read("src/buddy/lifecycle/deriveLifecycleState.ts");
const GEN_SCENARIOS = read("src/lib/pricing/scenarios/generateScenarios.ts");
const PRICING_ASSUMPTIONS = read("src/app/api/deals/[dealId]/pricing-assumptions/route.ts");

describe("SPEC-PRICING-SPREADS-SNAPSHOT-SOURCE-OF-TRUTH-1 guards", () => {

  // ── Guard 1: spread-output persists canonical financial snapshot ───────────
  test("Guard 1: spread-output imports and calls persistFinancialSnapshot", () => {
    assert.match(
      SPREAD_OUTPUT,
      /persistFinancialSnapshot/,
      "spread-output must call persistFinancialSnapshot after building report",
    );
    assert.match(
      SPREAD_OUTPUT,
      /buildDealFinancialSnapshotForBank/,
      "spread-output must call buildDealFinancialSnapshotForBank to build the snapshot",
    );
    assert.match(
      SPREAD_OUTPUT,
      /financialSnapshotPersistence/,
      "spread-output must import from financialSnapshotPersistence",
    );
  });

  // ── Guard 2: deriveLifecycleState reads financialSnapshotExists from financial_snapshots ──
  test("Guard 2: deriveLifecycleState counts financial_snapshots for financialSnapshotExists", () => {
    assert.match(
      DERIVE_LIFECYCLE,
      /from\("financial_snapshots"\)/,
      "deriveLifecycleState must query financial_snapshots table",
    );
    assert.match(
      DERIVE_LIFECYCLE,
      /financialSnapshotExists/,
      "deriveLifecycleState must set financialSnapshotExists from snapshot count",
    );
  });

  // ── Guard 3: generatePricingScenarios returns 422 when no financial snapshot ──
  test("Guard 3: generatePricingScenarios returns 422 no_financial_snapshot when missing", () => {
    assert.match(
      GEN_SCENARIOS,
      /no_financial_snapshot/,
      "generatePricingScenarios must return error code no_financial_snapshot",
    );
    assert.match(
      GEN_SCENARIOS,
      /422/,
      "generatePricingScenarios must return status 422 for missing snapshot",
    );
    assert.match(
      GEN_SCENARIOS,
      /from\("financial_snapshots"\)/,
      "generatePricingScenarios must query financial_snapshots table",
    );
  });

  // ── Guard 4: pricing-assumptions POST seeds from structural pricing + loan request ──
  test("Guard 4: pricing-assumptions POST reads deal_structural_pricing for defaults", () => {
    assert.match(
      PRICING_ASSUMPTIONS,
      /deal_structural_pricing/,
      "POST must read deal_structural_pricing for seeding defaults",
    );
    assert.match(
      PRICING_ASSUMPTIONS,
      /requested_rate_index/,
      "POST must read requested_rate_index from loan request",
    );
    // Must NOT hardcode SOFR as the only index code
    // The old code was: index_code: "SOFR" as const — ensure structural/LR is preferred
    assert.match(
      PRICING_ASSUMPTIONS,
      /spIndex|lrIndex/,
      "POST must derive index_code from structural pricing or loan request before falling back to SOFR",
    );
  });

  // ── Guard 5: pricing-assumptions GET uses canonical resolver for repairs ────
  test("Guard 5: pricing-assumptions GET uses resolveCanonicalPricingContext for repair", () => {
    assert.match(
      PRICING_ASSUMPTIONS,
      /resolveCanonicalPricingContext/,
      "GET must use canonical resolver (which persists repairs) instead of inline repair logic",
    );
    assert.match(
      PRICING_ASSUMPTIONS,
      /repaired/,
      "GET must flag repaired inputs in response",
    );
  });

  // ── Guard 6: spread-output surfaces snapshot warning if persistence fails ──
  test("Guard 6: spread-output surfaces snapshotWarning in response when persistence fails", () => {
    assert.match(
      SPREAD_OUTPUT,
      /snapshotWarning/,
      "spread-output must include snapshotWarning in response when snapshot persistence fails",
    );
    assert.match(
      SPREAD_OUTPUT,
      /snapshot persistence failed/,
      "spread-output must log when snapshot persistence fails",
    );
  });
});
