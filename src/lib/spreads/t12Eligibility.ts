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

/**
 * SPEC-T12-OPTIONAL-NEVER-PRIMARY-1
 *
 * System-wide rule: T12 (trailing-twelve operating statement) is OPTIONAL /
 * nice-to-have only. It must NEVER act as a primary prerequisite, blocker, next
 * action, readiness dependency, analysis-status dependency, or required/default
 * business spread.
 *
 * The primary business financial workflow is driven by annual financial
 * statements, tax returns, balance sheets, interim financials, and canonical
 * cash-flow facts (e.g. CASH_FLOW_AVAILABLE) — never by T12. A T12 orphan/error
 * row is a benign optional-artifact issue, not an upstream defect.
 *
 * This set is the single source of truth for "which spread types are optional".
 * Consumers (readiness/blocker engines, default recompute, analysis status,
 * UI labels) must treat membership here as "may be displayed, never required".
 */
export const OPTIONAL_SPREAD_TYPES: ReadonlySet<string> = new Set(["T12"]);

/** True when `spreadType` is optional / nice-to-have (never a primary dependency). */
export function isOptionalSpreadType(spreadType: string | null | undefined): boolean {
  return OPTIONAL_SPREAD_TYPES.has(String(spreadType ?? "").trim().toUpperCase());
}

/**
 * Filter the spread set a DEFAULT recompute would run. Optional spreads (T12)
 * are dropped UNLESS the deal actually supplied the optional artifact's source
 * (`hasOptionalSource`). Explicit per-type requests must NOT be routed through
 * this filter — an explicit request for T12 is always honored by the caller
 * before this helper is consulted.
 */
export function filterOptionalSpreadsForDefaultRecompute<T extends string>(
  types: readonly T[],
  opts: { hasOptionalSource: boolean },
): T[] {
  if (opts.hasOptionalSource) return [...types];
  return types.filter((t) => !isOptionalSpreadType(t));
}

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
