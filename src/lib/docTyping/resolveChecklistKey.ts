/**
 * Deterministic checklist key resolver.
 *
 * canonical_type + optional tax_year → checklist_key
 *
 * checklist_key is a DERIVED field. It is NEVER accepted from external input.
 * This is the single source of truth for the canonical_type → checklist slot mapping.
 *
 * Returns null for canonical types with no standard checklist slot (not an error —
 * those documents participate in intake without occupying a named checklist slot).
 *
 * Pure function — no server-only, safe for CI guards.
 */

export function resolveChecklistKey(
  canonicalType: string,
  taxYear: number | null,
): string | null {
  switch (canonicalType) {
    case "PERSONAL_FINANCIAL_STATEMENT":
      return "PFS_CURRENT";

    case "PERSONAL_TAX_RETURN":
      // Year is required — without it we cannot assign a slot
      return taxYear ? `IRS_PERSONAL_${taxYear}` : null;

    case "BUSINESS_TAX_RETURN":
      // Year is required — without it we cannot assign a slot
      return taxYear ? `IRS_BUSINESS_${taxYear}` : null;

    case "BALANCE_SHEET":
      return "FIN_STMT_BS_YTD";

    case "INCOME_STATEMENT":
      return "FIN_STMT_PL_YTD";

    case "RENT_ROLL":
      return "RENT_ROLL";

    case "BANK_STATEMENT":
      return "BANK_STMT_3M";

    // All other canonical types have no standard checklist slot mapping.
    // They participate in intake without occupying a named checklist slot.
    default:
      return null;
  }
}
