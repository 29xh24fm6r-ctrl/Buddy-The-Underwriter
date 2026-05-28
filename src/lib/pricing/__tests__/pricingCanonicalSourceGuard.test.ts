/**
 * SPEC-PRICING-CANONICAL-SOURCE-OF-TRUTH-1 — CI Guard Tests
 *
 * Guards:
 * 1. resolveCanonicalPricingContext exists and reads all three sources
 * 2. resolver persists repairs to deal_pricing_inputs (not memory-only)
 * 3. pricing-assumptions GET uses resolveCanonicalPricingContext
 * 4. page.tsx uses resolveCanonicalPricingContext, not raw deal_pricing_inputs
 * 5. generatePricingScenarios uses resolveCanonicalPricingContext for BASE
 * 6. DealPricingClient Deal Builder form is hidden (not a duplicate editable input)
 * 7. no bg-white/min-h-screen legacy shell in pricing route
 * 8. page.tsx error states use dark theme (no <main>)
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const RESOLVER = read("src/lib/pricing/resolveCanonicalPricingContext.ts");
const PRICING_ASSUMPTIONS = read("src/app/api/deals/[dealId]/pricing-assumptions/route.ts");
const PRICING_PAGE = read("src/app/(app)/deals/[dealId]/pricing/page.tsx");
const GEN_SCENARIOS = read("src/lib/pricing/scenarios/generateScenarios.ts");
const PRICING_CLIENT = read("src/app/(app)/deals/[dealId]/pricing/DealPricingClient.tsx");

describe("SPEC-PRICING-CANONICAL-SOURCE-OF-TRUTH-1 guards", () => {

  // ── Guard 1: resolver exists and reads all three sources ──────────────────
  test("Guard 1: resolveCanonicalPricingContext reads deal_pricing_inputs, structural, loan request", () => {
    assert.ok(existsSync(resolve(repoRoot, "src/lib/pricing/resolveCanonicalPricingContext.ts")));
    assert.match(RESOLVER, /deal_pricing_inputs/, "Must read deal_pricing_inputs");
    assert.match(RESOLVER, /deal_structural_pricing/, "Must read deal_structural_pricing");
    assert.match(RESOLVER, /deal_loan_requests/, "Must read deal_loan_requests");
    assert.match(RESOLVER, /source_priority/, "Must return source_priority diagnostics");
  });

  // ── Guard 2: resolver persists repairs ────────────────────────────────────
  test("Guard 2: resolver persists repairs to deal_pricing_inputs in DB", () => {
    assert.match(
      RESOLVER,
      /\.update\(repairPatch\)/,
      "Resolver must UPDATE deal_pricing_inputs when repair is needed",
    );
    assert.match(
      RESOLVER,
      /repair_applied/,
      "Resolver must return repair_applied flag",
    );
  });

  // ── Guard 3: pricing-assumptions GET uses resolver ────────────────────────
  test("Guard 3: pricing-assumptions GET uses resolveCanonicalPricingContext", () => {
    assert.match(
      PRICING_ASSUMPTIONS,
      /resolveCanonicalPricingContext/,
      "GET must use canonical resolver instead of inline repair logic",
    );
  });

  // ── Guard 4: page.tsx uses resolver, not raw deal_pricing_inputs ──────────
  test("Guard 4: page.tsx uses resolveCanonicalPricingContext for pricing data", () => {
    assert.match(
      PRICING_PAGE,
      /resolveCanonicalPricingContext/,
      "page.tsx must use canonical resolver",
    );
    // Must not directly query deal_pricing_inputs for DealPricingClient
    const pricingReadyBlock = PRICING_PAGE.slice(
      PRICING_PAGE.indexOf("const pricing = pricingResult.data"),
    );
    assert.doesNotMatch(
      pricingReadyBlock,
      /from\("deal_pricing_inputs"\)/,
      "page.tsx must not directly query deal_pricing_inputs after readiness clears — use resolver",
    );
  });

  // ── Guard 5: generatePricingScenarios uses canonical context ──────────────
  test("Guard 5: generatePricingScenarios uses resolveCanonicalPricingContext for BASE", () => {
    assert.match(
      GEN_SCENARIOS,
      /resolveCanonicalPricingContext/,
      "generatePricingScenarios must use canonical resolver",
    );
    assert.match(
      GEN_SCENARIOS,
      /canonical\.index_code/,
      "Must use canonical index_code for base loan params",
    );
    assert.match(
      GEN_SCENARIOS,
      /canonical\.loan_amount/,
      "Must use canonical loan_amount for base loan params",
    );
    assert.match(
      GEN_SCENARIOS,
      /canonical\.spread_bps/,
      "Must use canonical spread for BASE scenario",
    );
  });

  // ── Guard 6: Deal Builder form is hidden ──────────────────────────────────
  test("Guard 6: DealPricingClient Deal Builder form is hidden, not a visible duplicate", () => {
    // The Deal Builder section must have class="hidden" or be removed entirely
    assert.match(
      PRICING_CLIENT,
      /class(?:Name)?="[^"]*hidden[^"]*"[^>]*>\s*\n?\s*<Card title="Deal Builder"/,
      "Deal Builder section must be hidden via CSS — PricingAssumptionsCard is canonical",
    );
  });

  // ── Guard 7: no bg-white/min-h-screen legacy shell ────────────────────────
  test("Guard 7: no bg-white or min-h-screen legacy shell in pricing components", () => {
    assert.doesNotMatch(
      PRICING_CLIENT,
      /min-h-screen bg-white/,
      "DealPricingClient must not have legacy bg-white shell",
    );
    assert.doesNotMatch(
      PRICING_CLIENT,
      /<main[\s>]/,
      "DealPricingClient must not use <main> tag",
    );
  });

  // ── Guard 8: page.tsx error states use dark theme ─────────────────────────
  test("Guard 8: page.tsx error states do not use <main> or bg-slate-100", () => {
    assert.doesNotMatch(
      PRICING_PAGE,
      /<main className/,
      "page.tsx must not render <main> tags — use <div> for cockpit-native",
    );
    assert.doesNotMatch(
      PRICING_PAGE,
      /bg-slate-100/,
      "page.tsx must not use bg-slate-100 in error states",
    );
  });
});
