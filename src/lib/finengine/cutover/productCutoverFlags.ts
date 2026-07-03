/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 21: Product-by-Product Cutover Flags.
 *
 * Per-product cutover flags keyed on the canonical ProductKey taxonomy (PR 1),
 * so a product can be cut over from legacy to finengine independently and
 * without tenant-wide risk. ALL DEFAULT FALSE (legacy).
 *
 * The load-bearing safety rule: a product routes to finengine ONLY when its flag
 * is true AND its reconciliation is clean (no UNEXPECTED divergence). A flag on
 * with a blocked reconciliation FAILS SAFE to legacy — you cannot cut over dirty.
 *
 * Pure — takes an injectable flag map + reconciliation status.
 */

import { PRODUCT_KEYS, type ProductKey } from "@/lib/finengine/registry/productMetricRegistry";

export type ProductCutoverFlagMap = Record<ProductKey, boolean>;

/** DEFAULT: every product on the LEGACY engine. */
export const DEFAULT_PRODUCT_CUTOVER: ProductCutoverFlagMap = Object.fromEntries(
  PRODUCT_KEYS.map((p) => [p, false]),
) as ProductCutoverFlagMap;

export function isProductCutoverEnabled(
  product: ProductKey,
  flags: ProductCutoverFlagMap = DEFAULT_PRODUCT_CUTOVER,
): boolean {
  return flags[product] === true;
}

export type ReconciliationStatus = {
  /** True when any UNEXPECTED (unresolved) divergence exists for the product. */
  cutoverBlocked: boolean;
};

export type CutoverDecision = {
  product: ProductKey;
  path: "legacy" | "finengine";
  allowed: boolean;
  reason: string;
};

/**
 * Resolve the engine path for a product. finengine ONLY when the flag is true
 * AND reconciliation is clean; otherwise legacy (fail-safe).
 */
export function resolveProductCutover(
  product: ProductKey,
  flags: ProductCutoverFlagMap = DEFAULT_PRODUCT_CUTOVER,
  reconciliation: ReconciliationStatus = { cutoverBlocked: false },
): CutoverDecision {
  const flagOn = isProductCutoverEnabled(product, flags);
  if (!flagOn) {
    return { product, path: "legacy", allowed: false, reason: "cutover_flag_off" };
  }
  if (reconciliation.cutoverBlocked) {
    // Flag is on but the shadow reconciliation is not clean → fail safe to legacy.
    return { product, path: "legacy", allowed: false, reason: "reconciliation_blocked" };
  }
  return { product, path: "finengine", allowed: true, reason: "flag_on_and_reconciliation_clean" };
}

/** Convenience: the resolved path only. */
export function productEnginePath(
  product: ProductKey,
  flags: ProductCutoverFlagMap = DEFAULT_PRODUCT_CUTOVER,
  reconciliation: ReconciliationStatus = { cutoverBlocked: false },
): "legacy" | "finengine" {
  return resolveProductCutover(product, flags, reconciliation).path;
}

/** How many products are actually live on finengine (flag on + clean recon). */
export function cutoverProductCount(
  flags: ProductCutoverFlagMap,
  reconByProduct: Partial<Record<ProductKey, ReconciliationStatus>> = {},
): number {
  return PRODUCT_KEYS.filter(
    (p) => resolveProductCutover(p, flags, reconByProduct[p] ?? { cutoverBlocked: false }).path === "finengine",
  ).length;
}
