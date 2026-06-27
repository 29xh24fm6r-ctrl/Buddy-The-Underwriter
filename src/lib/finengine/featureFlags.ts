/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 5: per-product cutover flags.
 *
 * Cutover from the legacy engines to the finengine core is per-product and
 * behind a flag that DEFAULTS OFF (legacy path). Flipping a product OFF reverts
 * it instantly. A product is only flipped ON once its shadow diff is all
 * INTENDED/ZERO (§7). Pure — reads an injectable map (env-overridable upstream).
 */

export type ProductCutoverFlags = Record<string, boolean>;

/** Default: every product OFF (legacy path). */
export const DEFAULT_CUTOVER_FLAGS: ProductCutoverFlags = {
  CI_TERM: false,
  SBA_7A_STANDARD: false,
  SBA_7A_SMALL: false,
  SBA_504: false,
  ABL_REVOLVER: false,
  WORKING_CAPLINE: false,
  CRE_OWNER_OCC: false,
  CRE_INVESTOR: false,
};

/**
 * Is the finengine core live for a product? Defaults OFF. The caller may pass a
 * flag map (e.g. resolved from env / tenant config) to override.
 */
export function isProductCutOver(productId: string, flags: ProductCutoverFlags = DEFAULT_CUTOVER_FLAGS): boolean {
  return flags[productId] === true;
}
