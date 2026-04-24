/**
 * Buddy SBA Score — pure scoring curves.
 *
 * Every sub-factor's raw value → 1..5 score lives here as a pure function.
 * No DB, no I/O, no LLM — just math. These curves get tuned as real deals
 * flow through and we see distributions.
 *
 * Each function returns null when the input is null, so missing inputs
 * propagate correctly through component re-normalization.
 */

// ─── Borrower strength ─────────────────────────────────────────────────

export function scoreFicoBand(fico: number | null): number | null {
  if (fico == null) return null;
  if (fico >= 760) return 5;
  if (fico >= 720) return 4;
  if (fico >= 680) return 3;
  if (fico >= 640) return 2;
  return 1;
}

/** Liquid assets relative to required equity injection. Ratio ≥ 2x is strong. */
export function scoreLiquidityRatio(
  liquidAssets: number | null,
  requiredInjection: number | null,
): number | null {
  if (liquidAssets == null || requiredInjection == null) return null;
  if (requiredInjection <= 0) return 3; // no injection required → neutral
  const ratio = liquidAssets / requiredInjection;
  if (ratio >= 2.0) return 5;
  if (ratio >= 1.5) return 4;
  if (ratio >= 1.0) return 3;
  if (ratio >= 0.5) return 2;
  return 1;
}

/** Net worth relative to loan amount. */
export function scoreNetWorthRatio(
  netWorth: number | null,
  loanAmount: number | null,
): number | null {
  if (netWorth == null || loanAmount == null || loanAmount <= 0) return null;
  const ratio = netWorth / loanAmount;
  if (ratio >= 1.0) return 5;
  if (ratio >= 0.5) return 4;
  if (ratio >= 0.25) return 3;
  if (ratio >= 0.1) return 2;
  return 1;
}

export function scoreIndustryExperience(years: number | null): number | null {
  if (years == null) return null;
  if (years >= 10) return 5;
  if (years >= 5) return 4;
  if (years >= 3) return 3;
  if (years >= 1) return 2;
  return 1;
}

/**
 * Management depth: simple count-based score over the parsed management_team
 * jsonb array. Shape flexibility means we only count non-empty entries.
 */
export function scoreManagementDepth(teamSize: number | null): number | null {
  if (teamSize == null) return null;
  if (teamSize >= 4) return 5;
  if (teamSize >= 3) return 4;
  if (teamSize >= 2) return 3;
  if (teamSize >= 1) return 2;
  return 1;
}

// ─── Business strength ─────────────────────────────────────────────────

/** Years in business — for existing businesses. Startups score low here. */
export function scoreYearsInBusiness(years: number | null): number | null {
  if (years == null) return null;
  if (years >= 10) return 5;
  if (years >= 5) return 4;
  if (years >= 3) return 3;
  if (years >= 2) return 2;
  return 1;
}

/** Feasibility composite (0–100 on buddy_feasibility_studies.composite_score). */
export function scoreFeasibilityComposite(
  composite: number | null,
): number | null {
  if (composite == null) return null;
  if (composite >= 85) return 5;
  if (composite >= 75) return 4;
  if (composite >= 65) return 3;
  if (composite >= 55) return 2;
  return 1;
}

/**
 * Industry default-rate tier — reads buildSBARiskProfile.industryFactor.tier.
 * We invert the risk tier (lower default = higher strength).
 */
export function scoreIndustryDefaultTier(
  tier: "low" | "medium" | "high" | "very_high" | "unknown" | null,
): number | null {
  if (tier == null) return null;
  switch (tier) {
    case "low":
      return 5;
    case "medium":
      return 4;
    case "high":
      return 2;
    case "very_high":
      return 1;
    case "unknown":
      return 3;
  }
}

// ─── Deal structure ────────────────────────────────────────────────────

/** Equity injection as fraction of total project cost. */
export function scoreEquityInjectionPct(pct: number | null): number | null {
  if (pct == null) return null;
  if (pct >= 0.25) return 5;
  if (pct >= 0.15) return 4;
  if (pct >= 0.1) return 3; // SBA floor for most 7(a) deals
  if (pct >= 0.05) return 2;
  return 1;
}

/** Loan-to-project ratio (lower is better — more equity/other capital in). */
export function scoreLoanToProject(ratio: number | null): number | null {
  if (ratio == null) return null;
  if (ratio <= 0.6) return 5;
  if (ratio <= 0.75) return 4;
  if (ratio <= 0.85) return 3;
  if (ratio <= 0.9) return 2;
  return 1;
}

/** Collateral coverage — net_lendable_value / loan_amount. */
export function scoreCollateralCoverage(
  coverage: number | null,
): number | null {
  if (coverage == null) return null;
  if (coverage >= 1.0) return 5;
  if (coverage >= 0.75) return 4;
  if (coverage >= 0.5) return 3;
  if (coverage >= 0.25) return 2;
  return 1;
}

/** SBA guaranty percentage (7a ranges 50-85%, 504 is different structure). */
export function scoreGuarantyCoverage(pct: number | null): number | null {
  if (pct == null) return null;
  if (pct >= 0.85) return 5;
  if (pct >= 0.75) return 4;
  if (pct >= 0.5) return 3;
  if (pct >= 0.25) return 2;
  return 1;
}

// ─── Repayment capacity ────────────────────────────────────────────────

export function scoreBaseDSCR(dscr: number | null): number | null {
  if (dscr == null) return null;
  if (dscr >= 1.6) return 5;
  if (dscr >= 1.4) return 4;
  if (dscr >= 1.25) return 3; // SBA floor
  if (dscr >= 1.15) return 2;
  return 1;
}

export function scoreStressDSCR(dscr: number | null): number | null {
  if (dscr == null) return null;
  if (dscr >= 1.35) return 5;
  if (dscr >= 1.2) return 4;
  if (dscr >= 1.1) return 3;
  if (dscr >= 1.0) return 2;
  return 1;
}

/**
 * Projected-vs-historical variance. |projected - historical| / historical.
 * Smaller variance = projections are grounded. null if either missing.
 */
export function scoreProjectedVsHistoricalVariance(
  projected: number | null,
  historical: number | null,
): number | null {
  if (projected == null || historical == null || historical === 0) return null;
  const variance = Math.abs(projected - historical) / Math.abs(historical);
  if (variance <= 0.1) return 5;
  if (variance <= 0.2) return 4;
  if (variance <= 0.35) return 3;
  if (variance <= 0.5) return 2;
  return 1;
}

export function scoreGlobalDSCR(dscr: number | null): number | null {
  if (dscr == null) return null;
  if (dscr >= 1.5) return 5;
  if (dscr >= 1.3) return 4;
  if (dscr >= 1.15) return 3;
  if (dscr >= 1.0) return 2;
  return 1;
}

/**
 * Loan-term risk tier — reads buildSBARiskProfile.loanTermFactor.tier.
 * Shorter term = lower risk = higher score here.
 */
export function scoreLoanTermRiskTier(
  tier: "low" | "medium" | "high" | "very_high" | "unknown" | null,
): number | null {
  if (tier == null) return null;
  switch (tier) {
    case "low":
      return 5;
    case "medium":
      return 4;
    case "high":
      return 2;
    case "very_high":
      return 1;
    case "unknown":
      return 3;
  }
}

// ─── Franchise quality ─────────────────────────────────────────────────

export function scoreFranchiseSbaCertification(
  status: string | null,
): number | null {
  if (status == null) return null;
  const s = status.toLowerCase();
  if (s === "certified" || s === "approved") return 5;
  if (s === "eligible" || s === "listed") return 4;
  if (s === "conditional" || s === "pending") return 3;
  if (s === "not_listed" || s === "under_review") return 2;
  return 1;
}

/**
 * FDD Item 19 tier — uses percentile_rank (0–100) on the key metric.
 * Higher percentile on AUV/EBITDA = better brand economics.
 */
export function scoreFddItem19Percentile(
  percentile: number | null,
): number | null {
  if (percentile == null) return null;
  if (percentile >= 75) return 5;
  if (percentile >= 60) return 4;
  if (percentile >= 45) return 3;
  if (percentile >= 30) return 2;
  return 1;
}

export function scoreBrandMaturity(unitCount: number | null): number | null {
  if (unitCount == null) return null;
  if (unitCount >= 500) return 5;
  if (unitCount >= 200) return 4;
  if (unitCount >= 100) return 3;
  if (unitCount >= 50) return 2;
  return 1;
}

/**
 * Franchisor support — binary until the dedicated scoring ships.
 * Derived flag from (has_item_19 AND sba_eligible AND unit_count >= 50).
 */
export function scoreFranchisorSupportBinary(
  supported: boolean | null,
): number | null {
  if (supported == null) return null;
  return supported ? 4 : 2;
}
