/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 1: Finengine Registry Consolidation.
 *
 * PRODUCT → REQUIRED CANONICAL METRICS. A pure data map declaring, per loan
 * product, the canonical METRIC_REGISTRY ids that a complete underwrite of that
 * product must be able to compute. This is the seed the Product Intelligence
 * Framework (PR 7) will consume for its missing-metric blocker system; shipping
 * it now, registry-validated, means PR 7 inherits a map already proven to
 * reference only real canonical metrics (no magic ids).
 *
 * NOTE: this declares *required metric coverage*, not thresholds or policy. No
 * value judgement, no live behavior — data only.
 *
 * Pure + standalone.
 */

export type ProductKey =
  | "CI_TERM"
  | "WORKING_CAPITAL_LINE"
  | "AR_REVOLVER"
  | "ABL_REVOLVER"
  | "EQUIPMENT"
  | "CRE_OWNER_OCCUPIED"
  | "CRE_INVESTOR"
  | "CONSTRUCTION"
  | "SBA_7A"
  | "SBA_504"
  | "BUSINESS_ACQUISITION"
  | "FRANCHISE"
  | "GUIDANCE_LINE"
  | "RENEWAL_MODIFICATION";

export const PRODUCT_KEYS: readonly ProductKey[] = [
  "CI_TERM",
  "WORKING_CAPITAL_LINE",
  "AR_REVOLVER",
  "ABL_REVOLVER",
  "EQUIPMENT",
  "CRE_OWNER_OCCUPIED",
  "CRE_INVESTOR",
  "CONSTRUCTION",
  "SBA_7A",
  "SBA_504",
  "BUSINESS_ACQUISITION",
  "FRANCHISE",
  "GUIDANCE_LINE",
  "RENEWAL_MODIFICATION",
] as const;

/**
 * Every id below MUST exist in METRIC_REGISTRY — the registry audit fails the
 * build if one drifts. Keep entries to metrics that are genuinely load-bearing
 * for the product's repayment / collateral story.
 */
export const REQUIRED_METRICS_BY_PRODUCT: Record<ProductKey, readonly string[]> = {
  CI_TERM: ["DSCR", "DEBT_TO_EBITDA", "CURRENT_RATIO", "NET_WORTH", "FIXED_CHARGE_COVERAGE"],
  WORKING_CAPITAL_LINE: ["CURRENT_RATIO", "QUICK_RATIO", "WORKING_CAPITAL", "AR_DAYS", "DPO"],
  AR_REVOLVER: ["AR_TURNOVER", "AR_DAYS", "CURRENT_RATIO", "WORKING_CAPITAL"],
  ABL_REVOLVER: ["AR_TURNOVER", "AR_DAYS", "INVENTORY_TURNOVER", "DIO", "CURRENT_RATIO"],
  EQUIPMENT: ["DSCR", "DEBT_TO_EBITDA", "FIXED_CHARGE_COVERAGE", "NET_WORTH"],
  CRE_OWNER_OCCUPIED: ["DSCR", "GCF_DSCR", "LTV_GROSS", "NOI", "DEBT_YIELD"],
  CRE_INVESTOR: ["NOI", "NOI_MARGIN", "DSCR", "LTV_GROSS", "DEBT_YIELD", "CAP_RATE"],
  CONSTRUCTION: ["LTV_GROSS", "DSCR", "NET_WORTH", "TANGIBLE_NET_WORTH"],
  SBA_7A: ["DSCR", "GCF_DSCR", "DEBT_TO_EBITDA", "CURRENT_RATIO", "NET_WORTH"],
  SBA_504: ["DSCR", "LTV_GROSS", "DEBT_TO_EBITDA", "NET_WORTH"],
  BUSINESS_ACQUISITION: ["DSCR", "GCF_DSCR", "DEBT_TO_EBITDA", "EBITDA", "TANGIBLE_NET_WORTH"],
  FRANCHISE: ["DSCR", "DEBT_TO_EBITDA", "EBITDA_MARGIN", "CURRENT_RATIO"],
  GUIDANCE_LINE: ["CURRENT_RATIO", "WORKING_CAPITAL", "DEBT_TO_EQUITY"],
  RENEWAL_MODIFICATION: ["DSCR", "DEBT_TO_EBITDA", "CURRENT_RATIO", "NET_WORTH"],
};

/** Required canonical metric ids for a product (empty for an unknown key). */
export function requiredMetricsForProduct(product: ProductKey): readonly string[] {
  return REQUIRED_METRICS_BY_PRODUCT[product] ?? [];
}

/** The union of every product's required metrics — used by the registry audit. */
export function allRequiredProductMetrics(): string[] {
  const set = new Set<string>();
  for (const key of PRODUCT_KEYS) {
    for (const m of REQUIRED_METRICS_BY_PRODUCT[key]) set.add(m);
  }
  return [...set];
}
