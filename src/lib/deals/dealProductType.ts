/**
 * Deal product-type helpers — single source of truth for SBA-vs-LOC routing.
 *
 * Background: `deals.deal_type` was defaulting to 'SBA' for every new deal,
 * so conventional LOC deals were inheriting SBA-only checklists and pricing.
 * The fix introduced `deals.product_type` as a separate column. This module
 * is the canonical reader.
 *
 * Rule: any callsite that needs to branch SBA-only behavior must use
 * `requiresSBAChecklist()` or `isLOC()` here — never read `deal_type` directly
 * for that purpose, and never assume SBA from absence of a product_type.
 */

export type DealType = "CONVENTIONAL" | "SBA";

export type ProductType =
  | "LINE_OF_CREDIT"
  | "TERM_LOAN"
  | "CRE"
  | "CRE_OWNER_OCCUPIED"
  | "CRE_INVESTOR"
  | "SBA_7A"
  | "SBA_504"
  | "SBA_EXPRESS";

export type DealLike = {
  deal_type?: string | null;
  product_type?: string | null;
};

const SBA_PRODUCTS: ReadonlySet<ProductType> = new Set([
  "SBA_7A",
  "SBA_504",
  "SBA_EXPRESS",
]);

const LOC_PRODUCTS: ReadonlySet<ProductType> = new Set([
  "LINE_OF_CREDIT",
]);

function readProductType(deal: DealLike): ProductType | null {
  const raw = String(deal.product_type ?? "").trim().toUpperCase();
  if (!raw) return null;
  switch (raw) {
    case "LINE_OF_CREDIT":
    case "TERM_LOAN":
    case "CRE":
    case "CRE_OWNER_OCCUPIED":
    case "CRE_INVESTOR":
    case "SBA_7A":
    case "SBA_504":
    case "SBA_EXPRESS":
      return raw;
    default:
      return null;
  }
}

export function getProductType(deal: DealLike): ProductType | null {
  return readProductType(deal);
}

/**
 * True when the deal's product is an SBA program (7(a), 504, Express).
 *
 * Strict: requires `product_type` to be explicitly set to an SBA value.
 * Returns false when product_type is NULL or non-SBA, even if deal_type='SBA'.
 *
 * Why: deal_type='SBA' on its own is the *legacy* signal we are replacing.
 * Until product_type is populated, callsites should NOT apply SBA-only logic.
 */
export function isSBA(deal: DealLike): boolean {
  const product = readProductType(deal);
  if (product == null) return false;
  return SBA_PRODUCTS.has(product);
}

/**
 * True when the deal's product is a Line of Credit.
 */
export function isLOC(deal: DealLike): boolean {
  const product = readProductType(deal);
  if (product == null) return false;
  return LOC_PRODUCTS.has(product);
}

/**
 * Guard for places that previously branched on `deal_type === 'SBA'`.
 *
 * Modern path: when `product_type` is set, that wins — SBA-class products
 * return true; LOC / TERM / CRE return false.
 *
 * Legacy fallback: when `product_type` is NULL (existing rows pre-P0a
 * migration), fall back to `deal_type === 'SBA'`. Every legacy SBA deal in
 * the database has product_type=NULL right now; without this fallback the
 * SBA checklist would silently disappear from in-flight deals on deploy.
 *
 * Once every deal has product_type populated, the legacy fallback can be
 * removed.
 */
export function requiresSBAChecklist(deal: DealLike): boolean {
  const product = readProductType(deal);
  if (product != null) return SBA_PRODUCTS.has(product);
  return String(deal.deal_type ?? "").trim().toUpperCase() === "SBA";
}

/**
 * True when banker review is required to set product_type.
 *
 * Existing deals have product_type=NULL; new deals also start NULL until the
 * banker selects a product. UI surfaces should treat null as a blocker for any
 * downstream gate that depends on product (pricing, memo, checklist).
 */
export function needsProductTypeSelection(deal: DealLike): boolean {
  return readProductType(deal) == null;
}
