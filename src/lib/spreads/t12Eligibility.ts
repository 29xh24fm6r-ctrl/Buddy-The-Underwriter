/**
 * T12 Eligibility Gate — SPEC-T12-GATE-1
 *
 * Canonical rule (from business owner, 2026-05-18):
 * T12 is NEVER required for CONVENTIONAL or SBA deals, regardless of entity
 * type (C-Corp, S-Corp, LLC, partnership, sole proprietor, or any other).
 *
 * T12 is only eligible when:
 * 1. The deal type is CRE (where monthly rent rolls are the primary data source), OR
 * 2. The deal has explicit monthly operating statements confirmed present
 *    (has_monthly_statements flag set by the banker or document classifier).
 *
 * T12 is NEVER auto-generated speculatively. It is an optional enhancement
 * when the borrower provides monthly statements — never a requirement.
 */

export type T12EligibilityInput = {
  deal_type: string | null;
  /** True only if the deal has 12 consecutive months of monthly operating statements
   * confirmed present by the document classifier or banker override. */
  has_monthly_statements?: boolean;
};

export type T12EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string };

const DEAL_TYPES_REQUIRING_ANNUAL_SPREAD = new Set([
  "CONVENTIONAL",
  "SBA",
  "SBA_7A",
  "SBA_504",
  "SBA_EXPRESS",
]);

export function isT12Eligible(input: T12EligibilityInput): T12EligibilityResult {
  const dealType = (input.deal_type ?? "").toUpperCase();

  // CRE deals with confirmed monthly statements are eligible
  if (!DEAL_TYPES_REQUIRING_ANNUAL_SPREAD.has(dealType)) {
    if (input.has_monthly_statements) {
      return { eligible: true };
    }
    // CRE without monthly statements — still not eligible for auto-generation
    return {
      eligible: false,
      reason: `T12 requires confirmed monthly operating statements. None present for deal_type=${dealType}.`,
    };
  }

  // CONVENTIONAL and SBA: never eligible for T12 regardless of documents
  if (input.has_monthly_statements) {
    // Monthly statements provided on a CONVENTIONAL/SBA deal — T12 is allowed
    // as a supplemental display, but NOT as a source for canonical facts.
    return {
      eligible: false,
      reason: `T12 may be displayed as supplemental for deal_type=${dealType} but must not source canonical facts. Use annual spread as primary.`,
    };
  }

  return {
    eligible: false,
    reason: `T12 is never required for deal_type=${dealType}. Annual tax returns and financial statements are the primary underwriting source.`,
  };
}

/**
 * Whether T12 facts may be used as a SOURCE for canonical snapshot facts.
 * Stricter than isT12Eligible — even when T12 display is allowed (supplemental),
 * it must never displace annual-statement facts in the canonical snapshot.
 */
export function isT12CanonicalFactSource(input: T12EligibilityInput): boolean {
  const dealType = (input.deal_type ?? "").toUpperCase();
  if (DEAL_TYPES_REQUIRING_ANNUAL_SPREAD.has(dealType)) {
    return false; // Never for CONVENTIONAL/SBA
  }
  // CRE: only if monthly statements are confirmed
  return input.has_monthly_statements === true;
}
