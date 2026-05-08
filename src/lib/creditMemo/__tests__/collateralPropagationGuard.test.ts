/**
 * SPEC-FOUNDATION-V1 PR2 — Collateral propagation CI guard.
 *
 * Submission-pipeline-level guard asserting the canonical memo build
 * pipeline will always produce a non-null collateral.gross_value when
 * deal_collateral_items has rows with non-null estimated_value — either
 * from facts (tier 1/2) or from the canonical-store fallback (tier 3).
 *
 * This guard reads factsAdapter.ts source to assert the wiring:
 *   - deal_collateral_items referenced (proving the fallback is wired)
 *   - Canonical:DEAL_COLLATERAL_ITEMS provenance label (proving sourcing)
 *   - deal_id filtering present (proving scope isolation)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const FACTS_ADAPTER_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/canonical/factsAdapter.ts",
);

function read(): string {
  return readFileSync(FACTS_ADAPTER_PATH, "utf8");
}

test("[collateral-propagation-1] factsAdapter references deal_collateral_items for fallback", () => {
  const body = read();
  assert.match(
    body,
    /deal_collateral_items/,
    "factsAdapter.ts must reference deal_collateral_items to provide a fallback when no COLLATERAL facts exist.",
  );
});

test("[collateral-propagation-2] factsAdapter uses Canonical:DEAL_COLLATERAL_ITEMS provenance", () => {
  const body = read();
  assert.match(
    body,
    /Canonical:DEAL_COLLATERAL_ITEMS/,
    "factsAdapter.ts must use provenance labels starting with 'Canonical:DEAL_COLLATERAL_ITEMS' to distinguish fallback-sourced values from fact-sourced values.",
  );
});

test("[collateral-propagation-3] fallback query filters by deal_id", () => {
  const body = read();
  // The deal_collateral_items query should have .eq("deal_id", ...)
  const queryIdx = body.indexOf('from("deal_collateral_items")');
  assert.ok(queryIdx > -1, "deal_collateral_items query must exist");
  const afterQuery = body.slice(queryIdx, queryIdx + 200);
  assert.match(
    afterQuery,
    /\.eq\(\s*["']deal_id["']\s*,\s*args\.dealId\s*\)/,
    "Fallback query must filter by deal_id for scope isolation.",
  );
});
