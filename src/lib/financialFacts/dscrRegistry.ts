/**
 * SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1 — DSCR definition registry.
 *
 * THE single source of truth for every DSCR-like coverage metric in Buddy. Before this registry the
 * codebase computed "DSCR" at least three incompatible ways across surfaces (interest-only denominator
 * on the classic spread, global P&I in finengine, NCADS/proposed-ADS on the financials page), and
 * proposed-loan-only and interest-only coverage were both mislabeled as plain "DSCR" — a credit-safety
 * hazard, since the headline coverage number drives committee decisions.
 *
 * CANONICAL DECISION (SPEC-TIER5): the canonical underwriting DSCR is
 *     CF_NCADS / ANNUAL_DEBT_SERVICE
 * where CF_NCADS is the institutional cash-flow-waterfall output and ANNUAL_DEBT_SERVICE is
 * (proposed + existing) annual debt service. Every other coverage number is a DISTINCT, separately
 * labeled metric and MUST NOT be rendered as the headline "DSCR".
 *
 * Pure — no DB, no server-only. Unit-testable. Fact keys reference the canonical taxonomy in keys.ts.
 */

/** How a coverage metric relates to time / scenario. */
export type DscrTemporalKind = "canonical" | "historical" | "stressed" | "pro_forma" | "none";

export type DscrMetricDefinition = {
  /** Stable metric key (canonical fact key where one exists). */
  key: string;
  /** The ONLY sanctioned display label for this metric. */
  displayLabel: string;
  /** Canonical fact key (or description) of the numerator. */
  numeratorKey: string;
  numeratorLabel: string;
  /** Canonical fact key (or description) of the denominator. */
  denominatorKey: string;
  denominatorLabel: string;
  /** What this metric is for — the credit question it answers. */
  intendedUse: string;
  /** May this metric be rendered as the headline "DSCR"? Exactly one definition sets this true. */
  isHeadlineDscr: boolean;
  /** Eligible to be tested as a DSCR covenant. */
  isCovenantEligible: boolean;
  /** Global / sponsor-support coverage (all obligations across entities + guarantors). */
  isGlobalSponsorSupport: boolean;
  /** Coverage of the PROPOSED loan only (not total debt service) — never a DSCR. */
  isProposedLoanOnly: boolean;
  /** Temporal / scenario nature. */
  temporalKind: DscrTemporalKind;
};

/** The canonical headline DSCR key. */
export const CANONICAL_DSCR_KEY = "DSCR";

export const DSCR_DEFINITIONS: Record<string, DscrMetricDefinition> = {
  // ---- Canonical headline underwriting DSCR ----
  DSCR: {
    key: "DSCR",
    displayLabel: "DSCR",
    numeratorKey: "CF_NCADS",
    numeratorLabel: "Net cash available for debt service (institutional waterfall)",
    denominatorKey: "ANNUAL_DEBT_SERVICE",
    denominatorLabel: "Annual debt service (proposed + existing)",
    intendedUse:
      "Canonical underwriting coverage of TOTAL annual debt service by institutional NCADS — the headline DSCR.",
    isHeadlineDscr: true,
    isCovenantEligible: true,
    isGlobalSponsorSupport: false,
    isProposedLoanOnly: false,
    temporalKind: "canonical",
  },

  // ---- Global / sponsor-support coverage ----
  GCF_DSCR: {
    key: "GCF_DSCR",
    displayLabel: "Global DSCR (GCF)",
    numeratorKey: "GCF_GLOBAL_CASH_FLOW",
    numeratorLabel: "Global cash flow (all entities + sponsors)",
    denominatorKey: "ANNUAL_DEBT_SERVICE",
    denominatorLabel: "Annual debt service (proposed + existing)",
    intendedUse:
      "Global/sponsor-support coverage of total debt service by combined entity + guarantor cash flow.",
    isHeadlineDscr: false,
    isCovenantEligible: true,
    isGlobalSponsorSupport: true,
    isProposedLoanOnly: false,
    temporalKind: "canonical",
  },

  // ---- Proposed-loan-only coverage (NOT a DSCR) ----
  PROPOSED_LOAN_COVERAGE: {
    key: "PROPOSED_LOAN_COVERAGE",
    displayLabel: "Proposed Loan Coverage",
    numeratorKey: "CF_NCADS",
    numeratorLabel: "Net cash available for debt service (institutional waterfall)",
    denominatorKey: "ANNUAL_DEBT_SERVICE_PROPOSED",
    denominatorLabel: "Proposed annual debt service only",
    intendedUse:
      "Coverage of the PROPOSED loan's debt service only — a sizing sensitivity, NOT total-debt DSCR.",
    isHeadlineDscr: false,
    isCovenantEligible: false,
    isGlobalSponsorSupport: false,
    isProposedLoanOnly: true,
    temporalKind: "none",
  },

  // ---- Interest-only coverage (NOT a DSCR) ----
  INTEREST_ONLY_COVERAGE: {
    key: "INTEREST_ONLY_COVERAGE",
    displayLabel: "Interest-Only Coverage",
    numeratorKey: "CF_NCADS",
    numeratorLabel: "Net cash available for debt service (institutional waterfall)",
    denominatorKey: "ANNUAL_INTEREST_EXPENSE",
    denominatorLabel: "Annual interest expense only",
    intendedUse:
      "Coverage of interest only (no principal). Must NEVER be rendered as DSCR — it overstates repayment capacity.",
    isHeadlineDscr: false,
    isCovenantEligible: false,
    isGlobalSponsorSupport: false,
    isProposedLoanOnly: false,
    temporalKind: "none",
  },

  // ---- Historical actual DSCR (period actual debt service) ----
  HISTORICAL_ACTUAL_DSCR: {
    key: "HISTORICAL_ACTUAL_DSCR",
    displayLabel: "Historical Actual DSCR",
    numeratorKey: "CF_NCADS",
    numeratorLabel: "Net cash available for debt service (period actual)",
    denominatorKey: "ANNUAL_DEBT_SERVICE_EXISTING",
    denominatorLabel: "The period's ACTUAL debt service (existing debt only, not proposed)",
    intendedUse:
      "Backward-looking coverage using the period's actual debt service — must use actual, not proposed, debt service.",
    isHeadlineDscr: false,
    isCovenantEligible: false,
    isGlobalSponsorSupport: false,
    isProposedLoanOnly: false,
    temporalKind: "historical",
  },

  // ---- Stressed DSCR (+300bps) ----
  DSCR_STRESSED_300BPS: {
    key: "DSCR_STRESSED_300BPS",
    displayLabel: "Stressed DSCR (+300bps)",
    numeratorKey: "CF_NCADS",
    numeratorLabel: "Net cash available for debt service (institutional waterfall)",
    denominatorKey: "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
    denominatorLabel: "Annual debt service stressed +300bps",
    intendedUse: "Rate-stress scenario coverage — labeled stressed, never the headline DSCR.",
    isHeadlineDscr: false,
    isCovenantEligible: true,
    isGlobalSponsorSupport: false,
    isProposedLoanOnly: false,
    temporalKind: "stressed",
  },
};

/** Look up a DSCR metric definition by key (or null if not a registered DSCR-like metric). */
export function getDscrDefinition(key: string): DscrMetricDefinition | null {
  return DSCR_DEFINITIONS[key] ?? null;
}

/** The canonical headline DSCR definition. */
export function canonicalDscrDefinition(): DscrMetricDefinition {
  return DSCR_DEFINITIONS[CANONICAL_DSCR_KEY];
}

/** True iff this metric key may be rendered as the headline "DSCR". */
export function isHeadlineDscr(key: string): boolean {
  return getDscrDefinition(key)?.isHeadlineDscr === true;
}

/**
 * The sanctioned display label for a DSCR-like metric. Consumers MUST render coverage values through
 * this so proposed-loan / interest-only / global / historical / stressed coverage can never be shown
 * as a bare "DSCR". Unknown keys return the key itself (fail-visible, never a false "DSCR").
 */
export function dscrDisplayLabel(key: string): string {
  return getDscrDefinition(key)?.displayLabel ?? key;
}

/** All registered DSCR-like metric keys. */
export function allDscrMetricKeys(): string[] {
  return Object.keys(DSCR_DEFINITIONS);
}

/**
 * Compute a DSCR-like ratio from its numerator/denominator, honoring the credit-safe conventions:
 * null when inputs are missing or the denominator is <= 0 (a non-positive debt service makes coverage
 * meaningless — never report a bogus number). Returned value is unrounded.
 */
export function computeDscrLikeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}
