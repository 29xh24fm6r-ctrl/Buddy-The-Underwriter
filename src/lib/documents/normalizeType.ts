/**
 * Canonical Document Type Normalization
 *
 * Normalizes arbitrary classifier output strings to the canonical
 * CanonicalDocumentType enum. Handles form numbers, mixed case,
 * legacy strings, and alternate naming conventions.
 *
 * This is the authoritative normalizer — use this in the artifact processor.
 */

import type { CanonicalDocumentType } from "./classify";

/**
 * Normalize any classifier output string to a CanonicalDocumentType.
 *
 * Handles:
 * - Exact AI classifier types (IRS_BUSINESS, T12, etc.)
 * - IRS form numbers (1120, 1120S, 1065, 1040)
 * - Alternate names (INCOME_STATEMENT, BALANCE_SHEET, P&L)
 * - Legacy/mixed-case strings
 */
export function normalizeToCanonical(
  classifierOutput: string,
): CanonicalDocumentType {
  const upper = classifierOutput.toUpperCase().replace(/[_\s-]+/g, "_");

  if (
    [
      "IRS_BUSINESS",
      "IRS_1120",
      "IRS_1120S",
      "IRS_1065",
      "BUSINESS_TAX_RETURN",
    ].includes(upper)
  )
    return "BUSINESS_TAX_RETURN";

  if (
    ["IRS_PERSONAL", "IRS_1040", "PERSONAL_TAX_RETURN"].includes(upper)
  )
    return "PERSONAL_TAX_RETURN";

  if (["K1", "SCHEDULE_K1"].includes(upper)) return "PERSONAL_TAX_RETURN";

  if (
    [
      "FINANCIAL_STATEMENT",
      "INCOME_STATEMENT",
      "BALANCE_SHEET",
      "P&L",
      "T12",
    ].includes(upper)
  )
    return "FINANCIAL_STATEMENT";

  if (["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"].includes(upper))
    return "PFS";

  if (upper === "BANK_STATEMENT") return "BANK_STATEMENT";
  if (upper === "RENT_ROLL") return "RENT_ROLL";
  if (upper === "LEASE") return "LEASE";
  if (["INSURANCE", "COI", "INSURANCE_CERT"].includes(upper))
    return "INSURANCE";
  if (upper === "APPRAISAL") return "APPRAISAL";

  if (
    [
      "ARTICLES",
      "OPERATING_AGREEMENT",
      "BYLAWS",
      "BUSINESS_LICENSE",
      "ENTITY_DOCS",
    ].includes(upper)
  )
    return "ENTITY_DOCS";

  return "OTHER";
}
