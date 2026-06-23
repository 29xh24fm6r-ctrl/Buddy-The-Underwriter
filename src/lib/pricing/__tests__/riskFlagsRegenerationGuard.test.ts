/**
 * BUGFIX-RISK-PAGE-DEAL-FLAGS-STILL-NOT-LOADING-1 — CI Guard Tests
 *
 * Guards:
 * 1. /api/deals/[dealId]/flags/regenerate route exists
 * 2. RiskClient shows RegenerateFlagsButton when allFlags is empty
 * 3. RegenerateFlagsButton POSTs to /flags/regenerate
 * 4. RiskClient distinguishes "no flags found" from "all resolved"
 * 5. Regenerate button calls onComplete (loadFlags) after success
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const RISK_CLIENT = read("src/app/(app)/deals/[dealId]/risk/RiskClient.tsx");

describe("BUGFIX-RISK-PAGE-DEAL-FLAGS-STILL-NOT-LOADING-1 guards", () => {

  test("Guard 1: /flags/regenerate route exists and calls generateAndPersistFlags", () => {
    const routePath = resolve(repoRoot, "src/app/api/deals/[dealId]/flags/regenerate/route.ts");
    assert.ok(existsSync(routePath), "regenerate route must exist");
    const src = read("src/app/api/deals/[dealId]/flags/regenerate/route.ts");
    assert.match(src, /generateAndPersistFlags/, "Must call generateAndPersistFlags");
  });

  test("Guard 2: RiskClient shows RegenerateFlagsButton when no flags exist", () => {
    assert.match(
      RISK_CLIENT,
      /RegenerateFlagsButton/,
      "Must render RegenerateFlagsButton component",
    );
    assert.match(
      RISK_CLIENT,
      /allFlags\.length === 0/,
      "Must check allFlags.length === 0 to show regenerate button",
    );
  });

  test("Guard 3: RegenerateFlagsButton POSTs to /flags/regenerate", () => {
    assert.match(
      RISK_CLIENT,
      /\/flags\/regenerate/,
      "Must POST to /flags/regenerate endpoint",
    );
  });

  test("Guard 4: distinguishes 'no flags found' from 'all resolved'", () => {
    assert.match(
      RISK_CLIENT,
      /No risk flags found/,
      "Must show 'No risk flags found' when deal_flags table is empty",
    );
    assert.match(
      RISK_CLIENT,
      /All flags are resolved or waived/,
      "Must show 'All resolved' when flags exist but are all resolved/waived",
    );
  });

  test("Guard 5: regenerate button calls onComplete after success", () => {
    assert.match(
      RISK_CLIENT,
      /onComplete\(\)/,
      "Must call onComplete (loadFlags) after successful regeneration",
    );
  });
});
