/**
 * Business-spread context resolver — SPEC-BUSINESS-SPREADS-OPERATING-COMPANY-VIEW-1
 *
 * The Business Spreads page used to be hard-coded for real-estate / CRE deals: it
 * always requested BALANCE_SHEET + RENT_ROLL + T12 and described "the subject
 * property". For an operating company (e.g. Omnicare) that is wrong and confusing —
 * there is no rent roll and no trailing operating statement.
 *
 * This pure helper is the single source of truth for "which business spreads are
 * eligible for THIS deal". It is consumed by the Business Spreads page (fetch/query
 * construction), recompute request filtering when needed, and tests.
 *
 * Rules:
 *  - BALANCE_SHEET is always a primary business spread.
 *  - Operating company → the income statement / business spread (STANDARD).
 *  - CRE / property collateral → RENT_ROLL (a property section), never for an
 *    operating company.
 *  - T12 (trailing-twelve operating statement) is OPTIONAL everywhere and is only
 *    requested when a real T12 / monthly-operating source actually exists — never
 *    speculatively (see [[t12Eligibility]] / SPEC-T12-OPTIONAL-NEVER-PRIMARY-1).
 */

export type BusinessSpreadDealContext = {
  /** deals.deal_mode (e.g. quick_look / full_underwrite) — or any property/operating mode hint. */
  dealMode?: string | null;
  /** deals.deal_type — CONVENTIONAL | SBA. */
  dealType?: string | null;
  /** deals.product_type / collateral classification — the CRE / property signal. */
  collateralType?: string | null;
  /** True only when a real T12 / monthly operating-statement source exists. */
  hasT12Source?: boolean;
  /** True only when a real rent-roll source exists (CRE / property collateral). */
  hasRentRollSource?: boolean;
};

// Tokens that mark a deal as a real-estate / property-collateral deal where rent
// rolls and trailing operating performance are the primary financial data sources.
// Underscores/hyphens/spaces are normalized to spaces first so `CRE_INVESTOR`,
// `CRE-INVESTOR` and `CRE` all read as property collateral.
const PROPERTY_COLLATERAL_PATTERN =
  /\b(CRE|REAL ESTATE|PROPERTY|RENT ROLL|MULTIFAMILY|COMMERCIAL PROPERTY|INVESTMENT PROPERTY)\b/;

function matchesPropertySignal(value: string | null | undefined): boolean {
  const normalized = String(value ?? "")
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .trim();
  return PROPERTY_COLLATERAL_PATTERN.test(normalized);
}

/**
 * True when the deal is a real-estate / property-collateral deal. CRE deals show
 * property sections (balance sheet + rent roll + optional trailing operating
 * performance); operating companies do not.
 */
export function isPropertyCollateralMode(ctx: BusinessSpreadDealContext): boolean {
  // An actual rent-roll source is the strongest possible signal.
  if (ctx.hasRentRollSource) return true;
  return matchesPropertySignal(ctx.collateralType) || matchesPropertySignal(ctx.dealMode);
}

/**
 * Business-spread types the Business Spreads page should request/render for the
 * given deal context. Order is display order; BALANCE_SHEET (primary) is first and
 * the optional T12 is always last.
 */
export function getBusinessSpreadTypesForDealContext(
  ctx: BusinessSpreadDealContext,
): string[] {
  const property = isPropertyCollateralMode(ctx);
  const types: string[] = ["BALANCE_SHEET"];

  if (property) {
    // Property collateral: rent roll is a primary property section.
    types.push("RENT_ROLL");
  } else {
    // Operating company: income statement / business spread.
    types.push("STANDARD");
  }

  // T12 is OPTIONAL everywhere and only requested when a real source exists —
  // never speculatively (no orphan/error "Generating…" panels for ineligible types).
  if (ctx.hasT12Source) {
    types.push("T12");
  }

  return types;
}

/**
 * Context-aware header description for the Business Spreads page.
 */
export function getBusinessSpreadsHeaderCopy(ctx: BusinessSpreadDealContext): string {
  return isPropertyCollateralMode(ctx)
    ? "Property financial spreads, rent roll, and trailing operating performance where available."
    : "Business financial spreads from company statements and tax returns.";
}
