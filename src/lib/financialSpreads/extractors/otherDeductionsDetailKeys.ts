/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-1
 *
 * Defines the canonical fact key schema for line-level other deductions
 * detail extracted from business tax return attached statements.
 *
 * Parent aggregate: OTHER_DEDUCTIONS (Form 1120 line 26 / 1120-S line 19 / 1065 line 20)
 *
 * Detail keys follow the pattern: OD_DETAIL_{NORMALIZED_CATEGORY}_{YEAR}
 * Summary keys: OD_DETAIL_TOTAL_{YEAR}, OD_DETAIL_RECONCILED_{YEAR}
 *
 * These are written to deal_financial_facts with:
 *   fact_type = "TAX_RETURN_OTHER_DEDUCTIONS_DETAIL"
 *   fact_key = OD_DETAIL_{category}
 *   fact_period_end = tax year end date
 */

/** Normalized underwriting categories for other deduction line items */
export const OD_CATEGORIES = [
  "OFFICER_COMPENSATION",
  "WAGES_CONTRACT_LABOR",
  "RENT",
  "INSURANCE",
  "LEGAL_PROFESSIONAL",
  "ACCOUNTING",
  "CONSULTING",
  "MANAGEMENT_FEES",
  "RELATED_PARTY_PAYMENTS",
  "MEALS_ENTERTAINMENT",
  "TRAVEL_AUTO",
  "TAXES_LICENSES",
  "REPAIRS_MAINTENANCE",
  "BAD_DEBT",
  "DEPRECIATION_AMORTIZATION",
  "INTEREST",
  "CHARITABLE_CONTRIBUTIONS",
  "NON_RECURRING_OR_UNUSUAL",
  "OTHER_UNCATEGORIZED",
] as const;

export type OdCategory = typeof OD_CATEGORIES[number];

/** High-risk categories that warrant targeted borrower questions */
export const OD_HIGH_RISK_CATEGORIES: ReadonlySet<OdCategory> = new Set([
  "RELATED_PARTY_PAYMENTS",
  "MANAGEMENT_FEES",
  "CONSULTING",
  "NON_RECURRING_OR_UNUSUAL",
  "OTHER_UNCATEGORIZED",
]);

/** Categories that are potential add-backs for underwriting */
export const OD_POTENTIAL_ADDBACK_CATEGORIES: ReadonlySet<OdCategory> = new Set([
  "OFFICER_COMPENSATION",
  "RELATED_PARTY_PAYMENTS",
  "MANAGEMENT_FEES",
  "MEALS_ENTERTAINMENT",
  "NON_RECURRING_OR_UNUSUAL",
  "CHARITABLE_CONTRIBUTIONS",
]);

/** Fact type for other deductions detail in deal_financial_facts */
export const OD_DETAIL_FACT_TYPE = "TAX_RETURN_OTHER_DEDUCTIONS_DETAIL";

/** Summary fact keys */
export const OD_SUMMARY_KEYS = {
  DETAIL_TOTAL: "OD_DETAIL_TOTAL",
  UNCATEGORIZED_TOTAL: "OD_DETAIL_UNCATEGORIZED_TOTAL",
  RELATED_PARTY_TOTAL: "OD_DETAIL_RELATED_PARTY_TOTAL",
  POTENTIAL_ADDBACK_TOTAL: "OD_DETAIL_POTENTIAL_ADDBACK_TOTAL",
  NON_RECURRING_TOTAL: "OD_DETAIL_NON_RECURRING_TOTAL",
  RECONCILED: "OD_DETAIL_RECONCILED",
} as const;

/** Check if other deductions detail has been extracted for a given year */
export function hasOtherDeductionsDetail(
  facts: Record<string, unknown>,
  year: number,
): boolean {
  return facts[`${OD_SUMMARY_KEYS.DETAIL_TOTAL}_${year}`] != null;
}

/** Get the reconciliation status for a year */
export function isOtherDeductionsReconciled(
  facts: Record<string, unknown>,
  year: number,
): boolean {
  return facts[`${OD_SUMMARY_KEYS.RECONCILED}_${year}`] === true
    || facts[`${OD_SUMMARY_KEYS.RECONCILED}_${year}`] === 1;
}
