/**
 * Deterministic checklist key resolver.
 *
 * canonical_type + optional tax_year + optional statement_period → checklist_key
 *
 * checklist_key is a DERIVED field. It is NEVER accepted from external input.
 * This is the single source of truth for the canonical_type → checklist slot mapping.
 *
 * Returns null for canonical types with no standard checklist slot (not an error —
 * those documents participate in intake without occupying a named checklist slot).
 *
 * Phase P: BALANCE_SHEET and INCOME_STATEMENT now require a statement_period
 * discriminator to resolve to a specific checklist slot.
 *
 * Pure function — no server-only, safe for CI guards.
 */

/** Valid statement period discriminators for financial statements. */
export type StatementPeriod = "YTD" | "ANNUAL" | "CURRENT" | "HISTORICAL";

/** Canonical types that require a statement_period discriminator. */
export const PERIOD_REQUIRED_TYPES = new Set([
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
]);

export function resolveChecklistKey(
  canonicalType: string,
  taxYear: number | null,
  statementPeriod?: string | null,
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
      // Phase P: Discriminator required — CURRENT vs HISTORICAL
      if (statementPeriod === "CURRENT") return "FIN_STMT_BS_CURRENT";
      if (statementPeriod === "HISTORICAL") return "FIN_STMT_BS_HISTORICAL";
      return null;

    case "INCOME_STATEMENT":
      // Phase P: Discriminator required — YTD vs ANNUAL
      if (statementPeriod === "YTD") return "FIN_STMT_PL_YTD";
      if (statementPeriod === "ANNUAL") return "FIN_STMT_PL_ANNUAL";
      return null;

    case "RENT_ROLL":
      return "RENT_ROLL";

    case "BANK_STATEMENT":
      return "BANK_STMT_3M";

    case "COMMERCIAL_LEASE":
      return "LEASES_TOP";
    case "CREDIT_MEMO":
      return "CREDIT_MEMO_PRIOR";

    // All other canonical types have no standard checklist slot mapping.
    // They participate in intake without occupying a named checklist slot.
    default:
      return null;
  }
}
