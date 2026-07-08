/**
 * SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1 — factViews reconciles with the canonical mapping.
 *
 * The finengine balance-sheet adapter must NOT silently drop liquidity metrics or understate funded
 * debt vs classicSpread / modelEngine on the same deal.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canonicalView } from "@/lib/finengine/spread/factViews";

test("current assets derive from Schedule-L components when no subtotal fact exists (liquidity not dropped)", () => {
  const { v, src } = canonicalView({
    SL_CASH: 100, SL_AR_GROSS: 200, SL_AR_ALLOWANCE: 20, SL_INVENTORY: 300,
  });
  // (AR 200 − allowance 20) + cash 100 + inventory 300 = 580.
  assert.equal(v.currentAssets, 580);
  assert.equal(src.currentAssets, "derived(Σ components)");
});

test("current liabilities derive from Schedule-L components when no subtotal fact exists", () => {
  const { v } = canonicalView({ SL_ACCOUNTS_PAYABLE: 50, SL_SHORT_TERM_DEBT: 150 });
  assert.equal(v.currentLiabilities, 200);
});

test("a direct subtotal fact still wins over the component derivation", () => {
  const { v, src } = canonicalView({ TOTAL_CURRENT_ASSETS: 5000, SL_CASH: 100 });
  assert.equal(v.currentAssets, 5000);
  assert.equal(src.currentAssets, "TOTAL_CURRENT_ASSETS");
});

test("all-absent current-asset components yield null, never a fabricated 0", () => {
  const { v } = canonicalView({ NET_INCOME: 1000 });
  assert.equal(v.currentAssets, null);
  assert.equal(v.currentLiabilities, null);
});

test("funded debt includes loans from shareholders (distinct sum), not just mortgages/notes/bonds", () => {
  const { v, src } = canonicalView({ SL_MORTGAGES_NOTES_BONDS: 1000, SL_LOANS_FROM_SHAREHOLDERS: 500 });
  assert.equal(v.fundedDebt, 1500);
  assert.match(src.fundedDebt ?? "", /SL_LOANS_FROM_SHAREHOLDERS/);
});

test("funded debt de-dupes identical L19/L20 values (same loan reported twice)", () => {
  const { v } = canonicalView({ SL_MORTGAGES_NOTES_BONDS: 1_730_705, SL_LOANS_FROM_SHAREHOLDERS: 1_730_705 });
  assert.equal(v.fundedDebt, 1_730_705, "identical values must not be double-counted");
});

test("funded debt works from shareholder loans alone", () => {
  const { v } = canonicalView({ SL_LOANS_FROM_SHAREHOLDERS: 500 });
  assert.equal(v.fundedDebt, 500);
});

test("revenue uses NET_SALES_REVENUE and never the forbidden TOTAL_INCOME", () => {
  assert.equal(canonicalView({ TOTAL_INCOME: 9999 }).v.revenue, null, "TOTAL_INCOME is not a revenue base");
  assert.equal(canonicalView({ NET_SALES_REVENUE: 1000, GROSS_RECEIPTS: 1200 }).v.revenue, 1000);
});
