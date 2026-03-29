/**
 * SBA New Business Protocol — Phase 58A
 *
 * Detects businesses < 2 years old and applies SBA SOP 50 10 8
 * requirements for new business DSCR thresholds.
 *
 * Pure functions. No DB. No side effects.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SBA defines "new business" as < 2 years of operation */
const NEW_BUSINESS_THRESHOLD_MONTHS = 24;

/** Standard SBA DSCR minimum */
const SBA_DSCR_STANDARD = 1.25;

/** New business projected DSCR minimum per SOP 50 10 8 */
const SBA_DSCR_NEW_BUSINESS = 1.25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewBusinessInput {
  /** Business age in months (null = unknown) */
  businessAgeMonths: number | null;
  /** Date business was established (ISO string, null = unknown) */
  businessEstablishedDate: string | null;
  /** Whether the deal has historical financials (T12 or annual) */
  hasHistoricalFinancials: boolean;
  /** Whether the deal has projections */
  hasProjections: boolean;
  /** NAICS code for industry context */
  naicsCode: string | null;
}

export interface NewBusinessFlag {
  code: string;
  message: string;
  severity: "INFO" | "WARN" | "BLOCK";
}

export interface NewBusinessResult {
  isNewBusiness: boolean;
  businessAgeMonths: number | null;
  dscrThreshold: number;
  flags: NewBusinessFlag[];
  /** Whether projections are required (always true for new business) */
  projectionsRequired: boolean;
  /** Whether management experience is weighted higher */
  managementExperienceElevated: boolean;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Determine business age in months from an establishment date.
 * Returns null if date is invalid or missing.
 */
export function computeBusinessAgeMonths(
  establishedDate: string | null | undefined,
  asOfDate?: Date,
): number | null {
  if (!establishedDate) return null;

  const established = new Date(establishedDate);
  if (isNaN(established.getTime())) return null;

  const now = asOfDate ?? new Date();
  const diffMs = now.getTime() - established.getTime();
  if (diffMs < 0) return 0;

  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * Evaluate whether a business qualifies as "new" under SBA SOP 50 10 8
 * and determine applicable DSCR thresholds and flags.
 *
 * Pure function — deterministic, no side effects.
 */
export function evaluateNewBusinessProtocol(
  input: NewBusinessInput,
): NewBusinessResult {
  const flags: NewBusinessFlag[] = [];

  // Resolve business age
  let ageMonths = input.businessAgeMonths;
  if (ageMonths === null && input.businessEstablishedDate) {
    ageMonths = computeBusinessAgeMonths(input.businessEstablishedDate);
  }

  const isNewBusiness =
    ageMonths !== null && ageMonths < NEW_BUSINESS_THRESHOLD_MONTHS;

  // New business with unknown age is treated conservatively
  const ageUnknown = ageMonths === null;

  if (ageUnknown) {
    flags.push({
      code: "BUSINESS_AGE_UNKNOWN",
      message:
        "Business establishment date not provided. Cannot determine new business status.",
      severity: "WARN",
    });
  }

  if (isNewBusiness) {
    flags.push({
      code: "NEW_BUSINESS_DETECTED",
      message: `Business is ${ageMonths} months old (< 24 months). SBA new business protocol applies.`,
      severity: "INFO",
    });

    if (!input.hasProjections) {
      flags.push({
        code: "PROJECTIONS_REQUIRED",
        message:
          "SBA SOP 50 10 8 requires financial projections for businesses under 2 years old.",
        severity: "BLOCK",
      });
    }

    if (!input.hasHistoricalFinancials) {
      flags.push({
        code: "NO_HISTORICAL_FINANCIALS",
        message:
          "New business has no historical financials. DSCR must be evaluated from projections only.",
        severity: "WARN",
      });
    }

    // Businesses under 12 months get extra scrutiny
    if (ageMonths !== null && ageMonths < 12) {
      flags.push({
        code: "STARTUP_PHASE",
        message:
          "Business is in startup phase (< 12 months). Enhanced due diligence and management experience review required.",
        severity: "WARN",
      });
    }
  }

  // DSCR threshold: new businesses use projected DSCR at 1.25x
  // (not the 1.10x historical that some lenders allow for established businesses)
  const dscrThreshold = isNewBusiness
    ? SBA_DSCR_NEW_BUSINESS
    : SBA_DSCR_STANDARD;

  return {
    isNewBusiness,
    businessAgeMonths: ageMonths,
    dscrThreshold,
    flags,
    projectionsRequired: isNewBusiness,
    managementExperienceElevated: isNewBusiness,
  };
}

/**
 * Check if a DSCR value passes the applicable threshold.
 */
export function dscrPassesThreshold(
  dscr: number,
  isNewBusiness: boolean,
): boolean {
  const threshold = isNewBusiness ? SBA_DSCR_NEW_BUSINESS : SBA_DSCR_STANDARD;
  return dscr >= threshold;
}
