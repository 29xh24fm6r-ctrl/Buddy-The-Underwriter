/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 21 tests.
 *
 * All products default false (legacy). Cutover requires flag ON *and* clean
 * reconciliation; a dirty reconciliation fails safe to legacy.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PRODUCT_CUTOVER,
  isProductCutoverEnabled,
  resolveProductCutover,
  productEnginePath,
  cutoverProductCount,
  type ProductCutoverFlagMap,
} from "@/lib/finengine/cutover";
import { PRODUCT_KEYS } from "@/lib/finengine/registry/productMetricRegistry";

describe("PR21 — all products default to legacy", () => {
  it("every default flag is false", () => {
    for (const p of PRODUCT_KEYS) assert.equal(DEFAULT_PRODUCT_CUTOVER[p], false);
  });
  it("default path is legacy for every product", () => {
    for (const p of PRODUCT_KEYS) assert.equal(productEnginePath(p), "legacy");
  });
  it("covers the full product taxonomy (14)", () => {
    assert.equal(Object.keys(DEFAULT_PRODUCT_CUTOVER).length, PRODUCT_KEYS.length);
  });
});

describe("PR21 — cutover requires clean reconciliation", () => {
  const flagsOn: ProductCutoverFlagMap = { ...DEFAULT_PRODUCT_CUTOVER, CI_TERM: true };

  it("flag on + clean reconciliation → finengine", () => {
    const d = resolveProductCutover("CI_TERM", flagsOn, { cutoverBlocked: false });
    assert.equal(d.path, "finengine");
    assert.equal(d.allowed, true);
  });

  it("flag on + BLOCKED reconciliation → fails safe to legacy", () => {
    const d = resolveProductCutover("CI_TERM", flagsOn, { cutoverBlocked: true });
    assert.equal(d.path, "legacy");
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "reconciliation_blocked");
  });

  it("flag off → legacy regardless of reconciliation", () => {
    assert.equal(resolveProductCutover("CI_TERM", DEFAULT_PRODUCT_CUTOVER, { cutoverBlocked: false }).path, "legacy");
    assert.equal(isProductCutoverEnabled("CI_TERM"), false);
  });

  it("only the flagged product is affected", () => {
    assert.equal(productEnginePath("AR_REVOLVER", flagsOn), "legacy");
  });
});

describe("PR21 — cutover count", () => {
  it("counts only products live on finengine (flag on + clean)", () => {
    const flags: ProductCutoverFlagMap = { ...DEFAULT_PRODUCT_CUTOVER, CI_TERM: true, EQUIPMENT: true };
    // EQUIPMENT reconciliation blocked → should not count.
    const count = cutoverProductCount(flags, { EQUIPMENT: { cutoverBlocked: true } });
    assert.equal(count, 1); // only CI_TERM
  });

  it("zero by default", () => {
    assert.equal(cutoverProductCount(DEFAULT_PRODUCT_CUTOVER), 0);
  });
});
