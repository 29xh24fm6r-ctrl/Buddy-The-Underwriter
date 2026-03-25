/**
 * Default bank/product fallback policy values.
 * Used when no parsed bank credit policy exists.
 * Pure module — no DB, no server-only.
 */

/** Default advance rates by collateral type */
export const DEFAULT_ADVANCE_RATES: Record<string, number> = {
  real_estate: 0.75,
  equipment: 0.80,
  accounts_receivable: 0.85,
  inventory: 0.50,
  vehicle: 0.80,
  blanket_lien: 0.50,
  other: 0.50,
};

/** Default equity requirement by loan type (as decimal, e.g. 0.10 = 10%) */
export const DEFAULT_EQUITY_REQUIREMENTS: Record<string, number> = {
  sba_7a: 0.10,
  sba_504: 0.10,
  cre_mortgage: 0.20,
  construction: 0.25,
  equipment: 0.10,
  acquisition: 0.20,
  term_loan: 0.15,
  ci_loan: 0.15,
  usda_b_and_i: 0.10,
  line_of_credit: 0,
  other: 0.15,
};

/** Default LTV policy limit */
export const DEFAULT_LTV_LIMIT = 0.80;

/**
 * Get default advance rate for a collateral type.
 * Returns null if type is unknown — caller decides fallback behavior.
 */
export function getDefaultAdvanceRate(collateralType: string): number | null {
  return DEFAULT_ADVANCE_RATES[collateralType] ?? null;
}

/**
 * Get default equity requirement for a loan type.
 * Returns null if type is unknown.
 */
export function getDefaultEquityRequirement(loanType: string | undefined): number | null {
  if (!loanType) return null;
  return DEFAULT_EQUITY_REQUIREMENTS[loanType] ?? null;
}
