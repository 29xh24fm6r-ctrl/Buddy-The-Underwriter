/**
 * BUGFIX-PRICING-BASE-RATE-SOURCE-CONSISTENCY-1 — CI Guard Tests
 *
 * Ensures saved canonical index_rate_pct is not silently overwritten by live rates.
 *
 * Guards:
 * 1. Auto-populate only triggers on empty string, not on any falsy value
 * 2. "Using saved rate" source text shown when canonical rate exists
 * 3. "Use live rate" button exists for explicit user action
 * 4. Label does not say "— live" (misleading when using saved rate)
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const PRICING_CARD = read("src/components/deals/cockpit/panels/PricingAssumptionsCard.tsx");

describe("BUGFIX-PRICING-BASE-RATE-SOURCE-CONSISTENCY-1 guards", () => {

  test("Guard 1: auto-populate checks for empty string, not generic falsy", () => {
    assert.match(
      PRICING_CARD,
      /loaded\.index_rate_pct === ""/,
      "Auto-populate must check === '' (empty string), not !loaded.index_rate_pct (which would match '0')",
    );
  });

  test("Guard 2: shows 'Using saved rate' when canonical rate exists", () => {
    assert.match(
      PRICING_CARD,
      /Using saved rate/,
      "Must show source text 'Using saved rate: X%' when canonical rate is present",
    );
  });

  test("Guard 3: 'Use live rate' button exists for explicit user override", () => {
    assert.match(
      PRICING_CARD,
      /Use live rate/,
      "Must have a 'Use live rate' button for explicit user action",
    );
  });

  test("Guard 4: Index Rate label does not say '— live'", () => {
    assert.doesNotMatch(
      PRICING_CARD,
      /label=\{`Index Rate \(%\)\$\{.*live/,
      "Label must not append '— live' — it misleads when using saved rate",
    );
  });
});
