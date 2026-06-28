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

// ---------------------------------------------------------------------------
// SPEC-FINENGINE-MEMO-CUTOVER-1 — per-tenant memo-engine cutover.
//
// The credit memo / borrower report flips from the legacy classicSpread renderer
// to the finengine memo per TENANT, behind a flag that DEFAULTS OFF. Flipping a
// tenant OFF reverts instantly; the legacy renderer stays in place. A tenant is
// flipped ON only once its spread validation is cutover-clean (no UNEXPECTED).
// ---------------------------------------------------------------------------

/** tenant/bank id → memo-engine cutover enabled. Absent ⇒ OFF (legacy). */
export type TenantMemoCutoverFlags = Record<string, boolean>;

/** Default: no tenant cut over — every bank on the legacy memo renderer. */
export const DEFAULT_MEMO_CUTOVER_FLAGS: TenantMemoCutoverFlags = {};

/**
 * Is the finengine memo live for a tenant? Defaults OFF. The route resolves the
 * tenant's flags (env / bank config) and passes them; an unknown tenant is OFF.
 */
export function isMemoEngineCutOver(
  tenantId: string | null | undefined,
  flags: TenantMemoCutoverFlags = DEFAULT_MEMO_CUTOVER_FLAGS,
): boolean {
  if (!tenantId) return false;
  return flags[tenantId] === true;
}

// ---------------------------------------------------------------------------
// SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream F: sizing→pricing gate.
//
// The engine reconciles the priced facility against the engine-sized maximum and
// can GATE an over-sized (UNEXPECTED) facility — but only for a tenant whose
// sizing gate is flipped ON, behind a flag that DEFAULTS OFF. OFF = shadow only
// (log the classification, change nothing — today's borrower-facing behaviour is
// byte-for-byte preserved). Flipping a tenant ON is a deliberate, separate human
// step (a runbook like MEMO_CUTOVER.md); no tenant is ON in this run.
// ---------------------------------------------------------------------------

/** tenant/bank id → sizing→pricing gate enforced. Absent ⇒ OFF (shadow only). */
export type SizingGateFlags = Record<string, boolean>;

/** Default: no tenant gated — every bank on shadow-only (no price change). */
export const DEFAULT_SIZING_GATE_FLAGS: SizingGateFlags = {};

/** Is the sizing→pricing gate ENFORCED for a tenant? Defaults OFF (shadow only). */
export function isSizingGateOn(
  tenantId: string | null | undefined,
  flags: SizingGateFlags = DEFAULT_SIZING_GATE_FLAGS,
): boolean {
  if (!tenantId) return false;
  return flags[tenantId] === true;
}
