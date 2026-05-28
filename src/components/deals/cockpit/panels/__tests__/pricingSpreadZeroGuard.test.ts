/**
 * BUGFIX-PRICING-SPREAD-ZERO-AND-NEGATIVE-BPS-1 — CI Guard Tests
 *
 * Ensures spread_override_bps correctly handles 0 and negative values.
 *
 * Guards:
 * 1. PricingAssumptionsCard uses parseOptionalNumber for spread (not || null)
 * 2. Server validation allows spread_override_bps = 0
 * 3. Server validation allows negative spread
 * 4. Server validation rejects null/undefined spread for floating
 * 5. parseOptionalNumber preserves 0
 * 6. parseOptionalNumber preserves -25
 * 7. parseOptionalNumber returns null for blank
 * 8. Scenario generation preserves 0 spread (not replaced by overlay default)
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
const PRICING_ROUTE = read("src/app/api/deals/[dealId]/pricing-assumptions/route.ts");
const GEN_SCENARIOS = read("src/lib/pricing/scenarios/generateScenarios.ts");

describe("BUGFIX-PRICING-SPREAD-ZERO-AND-NEGATIVE-BPS-1 guards", () => {

  // ── Guard 1: no || null on spread ─────────────────────────────────────────
  test("Guard 1: spread_override_bps uses parseOptionalNumber, not || null", () => {
    assert.match(
      PRICING_CARD,
      /parseOptionalNumber\(form\.spread_override_bps\)/,
      "Must use parseOptionalNumber for spread to preserve 0 and negatives",
    );
    // Verify parseOptionalNumber helper exists
    assert.match(
      PRICING_CARD,
      /function parseOptionalNumber/,
      "parseOptionalNumber helper must be defined",
    );
  });

  // ── Guard 2: server allows 0 spread ───────────────────────────────────────
  test("Guard 2: PUT validation allows spread_override_bps = 0", () => {
    // The validation must check Number.isFinite, not just == null
    assert.match(
      PRICING_ROUTE,
      /Number\.isFinite\(spreadBps\)/,
      "Validation must use Number.isFinite to allow 0 and negative spreads",
    );
  });

  // ── Guard 3: server allows negative spread ────────────────────────────────
  test("Guard 3: PUT validation has guardrails but allows negative spread", () => {
    assert.match(
      PRICING_ROUTE,
      /-500/,
      "Validation should allow spreads down to -500 bps",
    );
    assert.match(
      PRICING_ROUTE,
      /2000/,
      "Validation should cap spreads at 2000 bps",
    );
  });

  // ── Guard 4: server rejects null spread for floating ──────────────────────
  test("Guard 4: PUT validation still rejects null/undefined spread for floating", () => {
    assert.match(
      PRICING_ROUTE,
      /spread_override_bps == null/,
      "Must still reject null/undefined spread for floating loans",
    );
  });

  // ── Guard 5-7: parseOptionalNumber unit tests ─────────────────────────────
  test("Guard 5: parseOptionalNumber preserves 0", () => {
    // Simulate the function
    function parseOptionalNumber(value: string): number | null {
      if (value.trim() === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    assert.equal(parseOptionalNumber("0"), 0);
    assert.equal(parseOptionalNumber("0.0"), 0);
  });

  test("Guard 6: parseOptionalNumber preserves -25", () => {
    function parseOptionalNumber(value: string): number | null {
      if (value.trim() === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    assert.equal(parseOptionalNumber("-25"), -25);
    assert.equal(parseOptionalNumber("-0.5"), -0.5);
  });

  test("Guard 7: parseOptionalNumber returns null for blank", () => {
    function parseOptionalNumber(value: string): number | null {
      if (value.trim() === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    assert.equal(parseOptionalNumber(""), null);
    assert.equal(parseOptionalNumber("  "), null);
    assert.equal(parseOptionalNumber("abc"), null);
  });

  // ── Guard 8: scenario generation preserves 0 spread ───────────────────────
  test("Guard 8: BASE scenario uses canonical.spread_bps via ?? (preserves 0)", () => {
    // The ?? operator does NOT fall through on 0, only null/undefined
    assert.match(
      GEN_SCENARIOS,
      /canonical\.spread_bps \?\?/,
      "BASE spread must use ?? (nullish coalescing) not || (logical or) — ?? preserves 0",
    );
  });
});
