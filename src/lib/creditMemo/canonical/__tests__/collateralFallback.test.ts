/**
 * SPEC-FOUNDATION-V1 PR2 — Collateral fallback structural tests.
 *
 * Verifies that computeCollateralValues in factsAdapter.ts has the
 * 3rd-tier fallback to deal_collateral_items when no collateral facts
 * exist. These are source-level assertions (same pattern as the
 * lifecycle-integration structural tests from SPEC-FLOW-V1 PR3).
 *
 * The tests read the source file and assert:
 *   1. The fallback query to deal_collateral_items is present
 *   2. Provenance labels are distinct from fact-based labels
 *   3. The fallback only triggers when facts are absent (needsFallback)
 *   4. All three metrics (gross, net, discounted) have fallback paths
 *   5. numOrNull helper is used for safe numeric coercion
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const FACTS_ADAPTER_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/canonical/factsAdapter.ts",
);

function read(): string {
  return readFileSync(FACTS_ADAPTER_PATH, "utf8");
}

test("[collateral-fallback-1] computeCollateralValues queries deal_collateral_items as fallback", () => {
  const body = read();
  assert.match(
    body,
    /deal_collateral_items/,
    "factsAdapter.ts must reference deal_collateral_items for the 3rd-tier fallback.",
  );
  assert.match(
    body,
    /\.from\(\s*["']deal_collateral_items["']\s*\)/,
    "factsAdapter.ts must query the deal_collateral_items table directly.",
  );
});

test("[collateral-fallback-2] fallback uses distinct provenance label", () => {
  const body = read();
  assert.match(
    body,
    /Canonical:DEAL_COLLATERAL_ITEMS:SUM/,
    "grossValue fallback must use provenance 'Canonical:DEAL_COLLATERAL_ITEMS:SUM' to distinguish from fact-sourced values.",
  );
  assert.match(
    body,
    /Canonical:DEAL_COLLATERAL_ITEMS:NET_LENDABLE_SUM/,
    "netValue fallback must use provenance 'Canonical:DEAL_COLLATERAL_ITEMS:NET_LENDABLE_SUM'.",
  );
  assert.match(
    body,
    /Canonical:DEAL_COLLATERAL_ITEMS:DISCOUNTED_SUM/,
    "discountedValue fallback must use provenance 'Canonical:DEAL_COLLATERAL_ITEMS:DISCOUNTED_SUM'.",
  );
});

test("[collateral-fallback-3] fallback only triggers when all fact-based metrics are null", () => {
  const body = read();
  assert.match(
    body,
    /needsFallback/,
    "factsAdapter.ts must compute a needsFallback gate before querying deal_collateral_items.",
  );
  // The gate should check grossMetric, netMetric, and discountedMetric
  assert.match(
    body,
    /grossMetric\.value\s*===\s*null/,
    "needsFallback must check grossMetric.value === null.",
  );
  assert.match(
    body,
    /netMetric\.value\s*===\s*null/,
    "needsFallback must check netMetric.value === null.",
  );
  assert.match(
    body,
    /discountedMetric\.value\s*===\s*null/,
    "needsFallback must check discountedMetric.value === null.",
  );
});

test("[collateral-fallback-4] grossValue prefers market_value over estimated_value per item", () => {
  const body = read();
  // The spec says: "Prefer market_value if present, else estimated_value"
  assert.match(
    body,
    /numOrNull\(\s*r\.market_value\s*\)\s*\?\?\s*numOrNull\(\s*r\.estimated_value\s*\)/,
    "Gross value fallback must prefer market_value ?? estimated_value per row.",
  );
});

test("[collateral-fallback-5] netValue sums net_lendable_value column", () => {
  const body = read();
  assert.match(
    body,
    /numOrNull\(\s*r\.net_lendable_value\s*\)/,
    "Net value fallback must read net_lendable_value from each row.",
  );
});

test("[collateral-fallback-6] discountedValue uses estimated_value × advance_rate", () => {
  const body = read();
  assert.match(
    body,
    /advance_rate/,
    "Discounted value fallback must reference advance_rate.",
  );
  // The multiplication: ev * ar
  assert.match(
    body,
    /ev\s*\*\s*ar/,
    "Discounted value fallback must multiply the value by advance_rate.",
  );
});

test("[collateral-fallback-7] fallback does NOT filter by bank_id (column absent from table)", () => {
  const body = read();
  // Extract just the deal_collateral_items query block
  const queryStart = body.indexOf('from("deal_collateral_items")');
  const queryEnd = body.indexOf(".eq(", queryStart);
  const queryBlock = body.slice(queryStart, queryEnd + 50);
  // Should filter by deal_id only
  assert.match(
    queryBlock,
    /\.eq\(\s*["']deal_id["']/,
    "Fallback query must filter by deal_id.",
  );
  // Should NOT have a bank_id filter in this block
  assert.ok(
    !queryBlock.includes("bank_id"),
    "Fallback query must NOT filter by bank_id — deal_collateral_items has no bank_id column (discovered during PIV-5 addendum).",
  );
});

test("[collateral-fallback-8] numOrNull helper exists for safe numeric coercion", () => {
  const body = read();
  assert.match(
    body,
    /function numOrNull\(/,
    "factsAdapter.ts must define numOrNull for safe numeric coercion of potentially null/undefined DB values.",
  );
});
