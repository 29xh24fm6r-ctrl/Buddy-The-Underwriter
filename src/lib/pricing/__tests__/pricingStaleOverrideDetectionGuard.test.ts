/**
 * BUGFIX-PRICING-STALE-MANUAL-OVERRIDE-DETECTION-1 — CI Guard Tests
 *
 * Guards:
 * 1. Resolver detects stale index_rate_pct on floating loans without manual lock
 * 2. Resolver triggers repair (upsert) to clear stale index_rate_pct
 * 3. GET fallback detects stale DB row when canonical.index_rate_source="live"
 * 4. hasStaleIndexRate condition covers the exact pattern
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
const PRICING_GET = read("src/app/api/deals/[dealId]/pricing-assumptions/route.ts");

describe("BUGFIX-PRICING-STALE-MANUAL-OVERRIDE-DETECTION-1 guards", () => {

  test("Guard 1: resolver detects stale index_rate_pct on floating with no manual lock", () => {
    assert.match(
      RESOLVER,
      /hasStaleIndexRate/,
      "Must detect stale index_rate_pct pattern",
    );
    assert.match(
      RESOLVER,
      /!hasManualOverride/,
      "Stale detection must check that there is no manual override",
    );
    assert.match(
      RESOLVER,
      /rate_type === "floating"/,
      "Stale detection must only apply to floating loans",
    );
  });

  test("Guard 2: stale index rate triggers repair", () => {
    assert.match(
      RESOLVER,
      /dpiIsInvalid \|\| indexConflict \|\| hasStaleIndexRate/,
      "needsRepair must include hasStaleIndexRate condition",
    );
    assert.match(
      RESOLVER,
      /stale structural index_rate_pct without manual lock/,
      "Must have repair reason for stale index rate",
    );
  });

  test("Guard 3: GET detects stale DB when canonical source is live", () => {
    assert.match(
      PRICING_GET,
      /index_rate_source === "live" && row\.index_rate_pct != null/,
      "GET must detect stale DB row when canonical says use live but DB has persisted rate",
    );
  });

  test("Guard 4: stale pattern covers exact condition", () => {
    // The stale pattern: dpiExists && floating && no manual override && index_rate_pct is non-null
    assert.match(
      RESOLVER,
      /dpiExists\s*\n?\s*&& rate_type === "floating"\s*\n?\s*&& !hasManualOverride\s*\n?\s*&& toFinite\(d\.index_rate_pct\) != null/,
      "hasStaleIndexRate must check all four conditions",
    );
  });
});
