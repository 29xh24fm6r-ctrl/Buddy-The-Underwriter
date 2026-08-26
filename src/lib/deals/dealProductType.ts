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

/**
 * STRICT reader for the canonical `deals.product_type` column.
 *
 * Deliberately does NOT accept the loose legacy spellings: a bare "SBA" in
 * product_type is ambiguous between 7(a), 504 and Express, and this column is
 * the one place that is supposed to be specific. See normalizeProductType
 * below for the lenient reconciler used on the legacy fields.
 */
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

/**
 * LENIENT reconciler for the legacy loan/product fields.
 *
 * Use this on `deals.loan_type`, `deals.deal_type` and `deal_intake.loan_type`
 * — the columns that accumulated free-form spellings — NOT on
 * `deals.product_type`, which readProductType keeps strict on purpose.
 *
 * SPEC-PRODUCT-TYPE-CANON-1. The 2026-08-26 audit found five fields carrying
 * four different vocabularies for "this is an SBA 7(a) deal":
 *
 *   deals.deal_type                   'SBA'          (claim_brokerage_session RPC)
 *   deals.product_type                NULL           (no production writer)
 *   deals.loan_type                   '7a'           (borrower intake progress)
 *   deal_intake.loan_type             'CRE'          (initializeIntake default)
 *   deal_intake_scenario.product_type absent         (banker routes only)
 *
 * Every consumer read a different one, so a borrower-originated SBA deal was
 * simultaneously "SBA" to the SBA API gate, NULL to isSBA(), '7a' to nothing
 * at all, and 'CRE' to both document checklists. This function is the single
 * place that reconciles the spellings; new writers should emit canonical
 * values and new readers should come through here.
 */
export function normalizeProductType(raw: unknown): ProductType | null {
  // Collapse punctuation and whitespace to single underscores, then trim them
  // from the ends, so "SBA 7(a)", "sba-7a" and "SBA_7A" all land on one key.
  const v = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!v) return null;
  switch (v) {
    case "LINE_OF_CREDIT":
    case "LOC":
      return "LINE_OF_CREDIT";
    case "TERM_LOAN":
    case "TERM":
      return "TERM_LOAN";
    case "CRE":
    case "CRE_OWNER_OCCUPIED":
    case "CRE_INVESTOR":
      return v as ProductType;
    case "CRE_OWNER_OCCUPIED_WITH_RENT":
      return "CRE_OWNER_OCCUPIED";
    // SBA 7(a) — every spelling seen in the wild, including the bare "7a"
    // the borrower concierge writes to deals.loan_type and the "SBA" the
    // brokerage session RPC writes to deals.deal_type.
    case "SBA_7A":
    case "SBA7A":
    case "SBA_7_A":
    case "7A":
    case "7_A":
    case "SBA":
    case "SBA_7A_STANDARD":
    case "SBA_7A_SMALL":
      return "SBA_7A";
    case "SBA_EXPRESS":
    case "SBAEXPRESS":
      return "SBA_EXPRESS";
    case "SBA_504":
    case "SBA504":
    case "504":
      return "SBA_504";
    default:
      return null;
  }
}

/**
 * Resolve a deal's product from every field that has historically carried it,
 * most authoritative first.
 *
 * Priority: deals.product_type (canonical) → deals.loan_type → deal_intake
 * .loan_type → deals.deal_type (the legacy 'SBA' flag, weakest because it
 * says only "SBA-ish", not which program).
 */
export function resolveProductType(deal: DealLike & {
  loan_type?: string | null;
  intake_loan_type?: string | null;
}): ProductType | null {
  // product_type is read STRICTLY — it is the canonical column and an
  // ambiguous value there should not be guessed at. The legacy fields are
  // read leniently, because that is where "7a" and "SBA" actually live.
  return (
    readProductType(deal) ??
    normalizeProductType(deal.loan_type) ??
    normalizeProductType(deal.intake_loan_type) ??
    normalizeProductType(deal.deal_type)
  );
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
