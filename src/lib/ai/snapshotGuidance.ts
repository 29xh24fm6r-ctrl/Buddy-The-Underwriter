/**
 * Shared prompt guidance for how the risk and memo generators must read the
 * AI deal snapshot (see lib/underwriting/aiDealSnapshot.ts).
 *
 * The snapshot now carries the bank's deterministic underwriting results
 * (canonicalMetrics) and separates complete fiscal years from interim
 * statements. Without this block the models re-derived coverage from raw net
 * income and read a six-month YTD figure as a full-year revenue collapse.
 */
export function snapshotGuidanceBlock(): string {
  return [
    "DEAL SNAPSHOT RULES (HARD):",
    "- DEAL.dealSnapshot.canonicalMetrics are the bank's deterministic underwriting results (cashFlowAvailable = normalized cash available for debt service, annualDebtService, dscr, dscrStressed300bps, globalCashFlow, globalDscr, ltvGross, collateralGrossValue, bankLoanTotal). They are AUTHORITATIVE for repayment capacity, coverage, leverage and collateral. Never re-derive DSCR or coverage from raw net income when canonicalMetrics.dscr is present; quote the canonical figures.",
    "- yearsAvailable, revenueTrend and netIncomeTrend contain COMPLETE fiscal years only. latestYear is the latest complete fiscal year.",
    "- interimPeriod (when present) is a PARTIAL-YEAR statement. Compare it to prior years only via annualizedRevenue / annualizedNetIncome. A YTD figure that is lower than a full prior year is NOT a revenue decline.",
    "- Read analysisNotes before writing; they state which figures are partial-year and the reconciliation status.",
    "- Grade, pricing and the recommendation must be consistent with canonicalMetrics (e.g. a DSCR well above 1.25x and an LTV at or below 0.80 cannot be described as constrained repayment capacity or thin collateral).",
  ].join("\n");
}
