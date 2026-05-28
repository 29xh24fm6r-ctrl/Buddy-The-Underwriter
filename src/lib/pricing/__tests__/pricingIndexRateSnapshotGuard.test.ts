/**
 * BUGFIX-PRICING-INDEX-RATE-SNAPSHOT-SEMANTICS-1 — CI Guard Tests
 *
 * Guards:
 * 1. Resolver returns index_rate_source field for provenance
 * 2. Resolver sets index_rate_pct=null for floating with no manual override (uses live)
 * 3. Resolver uses base_rate_override_pct as manual lock indicator
 * 4. Resolver does not persist structural index_rate_pct for floating
 * 5. PricingAssumptionsCard has IndexRateAnnotation showing locked vs live
 * 6. Scenario gen falls back to live rates when canonical index_rate_pct is null
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const RESOLVER = read("src/lib/pricing/resolveCanonicalPricingContext.ts");
const PRICING_CARD = read("src/components/deals/cockpit/panels/PricingAssumptionsCard.tsx");
const GEN_SCENARIOS = read("src/lib/pricing/scenarios/generateScenarios.ts");

describe("BUGFIX-PRICING-INDEX-RATE-SNAPSHOT-SEMANTICS-1 guards", () => {

  test("Guard 1: resolver returns index_rate_source for provenance", () => {
    assert.match(RESOLVER, /index_rate_source/, "Must return index_rate_source field");
    assert.match(RESOLVER, /"live"/, "Must support 'live' source");
    assert.match(RESOLVER, /"manual_override"/, "Must support 'manual_override' source");
    assert.match(RESOLVER, /"structural_placeholder"/, "Must support 'structural_placeholder' source");
  });

  test("Guard 2: floating with no manual override returns null index_rate_pct", () => {
    // The resolver must set index_rate_pct = null for floating + no lock
    assert.match(
      RESOLVER,
      /index_rate_pct = null;\s*\n\s*index_rate_source = "live"/,
      "Floating with no lock must set index_rate_pct=null and source='live'",
    );
  });

  test("Guard 3: base_rate_override_pct is the manual lock indicator", () => {
    assert.match(
      RESOLVER,
      /hasManualOverride.*base_rate_override_pct/,
      "Must check base_rate_override_pct as manual lock indicator",
    );
    assert.match(
      RESOLVER,
      /index_rate_source = "manual_override"/,
      "When base_rate_override_pct is set, source must be manual_override",
    );
  });

  test("Guard 4: resolver does not persist structural index_rate_pct for floating", () => {
    assert.match(
      RESOLVER,
      /index_rate_source === "live" \? null : index_rate_pct/,
      "Upsert must persist null index_rate_pct when source is live (floating, no lock)",
    );
  });

  test("Guard 5: card has IndexRateAnnotation showing locked vs live", () => {
    assert.match(PRICING_CARD, /IndexRateAnnotation/, "Must use IndexRateAnnotation component");
    assert.match(PRICING_CARD, /Using live rate/, "Must show 'Using live rate' when rate matches live");
    assert.match(PRICING_CARD, /Locked\/manual rate/, "Must show 'Locked/manual rate' when differs from live");
    assert.match(PRICING_CARD, /Use live rate/, "Must have 'Use live rate' button");
  });

  test("Guard 6: scenario gen falls back to live rates when canonical is null", () => {
    assert.match(
      GEN_SCENARIOS,
      /canonical\.index_rate_pct \?\? rates\[indexCode\]/,
      "Scenario gen must use ?? to fall through null canonical to live rates",
    );
  });
});
