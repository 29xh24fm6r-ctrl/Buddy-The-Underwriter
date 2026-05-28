/**
 * BUGFIX-PRICING-CANONICAL-UPSERT-SILENT-FAILURE-1 — CI Guard Tests
 *
 * Guards:
 * 1. Resolver clamps amort_months >= 1 (DB CHECK: amort_months > 0)
 * 2. Resolver clamps interest_only_months <= amort_months
 * 3. Resolver checks upsert error (not just try/catch)
 * 4. GET /pricing-assumptions falls back to canonical context when DB row is stale
 * 5. GET never returns null pricingAssumptions when canonical structural pricing exists
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

describe("BUGFIX-PRICING-CANONICAL-UPSERT-SILENT-FAILURE-1 guards", () => {

  test("Guard 1: resolver clamps amort_months >= 1 for DB CHECK constraint", () => {
    assert.match(
      RESOLVER,
      /Math\.max\(rawAmort,\s*1\)/,
      "amort_months must be clamped to minimum 1 (DB CHECK: amort_months > 0)",
    );
  });

  test("Guard 2: resolver clamps interest_only_months <= amort_months", () => {
    assert.match(
      RESOLVER,
      /Math\.min\(rawIo,\s*amort_months\)/,
      "interest_only_months must be clamped to <= amort_months (DB CHECK constraint)",
    );
  });

  test("Guard 3: resolver checks upsert error, not just try/catch", () => {
    assert.match(
      RESOLVER,
      /error:\s*upsertErr/,
      "Resolver must destructure { error } from upsert result and check it",
    );
    assert.match(
      RESOLVER,
      /upsertErr\.message/,
      "Resolver must log upsert error message when it fails",
    );
  });

  test("Guard 4: GET falls back to canonical context when DB row is stale", () => {
    assert.match(
      PRICING_GET,
      /dbStillStale/,
      "GET must detect when DB row is still stale after resolver ran",
    );
    assert.match(
      PRICING_GET,
      /effectiveAssumptions/,
      "GET must synthesize effectiveAssumptions from canonical context when stale",
    );
    assert.match(
      PRICING_GET,
      /canonical\.rate_type/,
      "Fallback must use canonical rate_type",
    );
    assert.match(
      PRICING_GET,
      /canonical\.index_rate_pct/,
      "Fallback must use canonical index_rate_pct",
    );
  });

  test("Guard 5: GET returns repaired flag when falling back to canonical", () => {
    assert.match(
      PRICING_GET,
      /DB row stale after resolver/,
      "GET must indicate when returning canonical fallback due to stale DB row",
    );
  });
});
