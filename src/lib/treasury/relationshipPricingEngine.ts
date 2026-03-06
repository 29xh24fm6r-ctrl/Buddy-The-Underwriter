/**
 * Relationship pricing engine — computes total relationship value
 * across loan, deposit, and treasury product revenue.
 * Pure function — no DB.
 */

import type { DepositProfile } from "@/lib/deposits/depositProfileBuilder";
import type { TreasuryProposal } from "./treasuryProposalEngine";

export type RelationshipPricingAnalysis = {
  loanSpreadContributionBps: number | null; // basis points
  depositEarningsCreditAnnual: number | null;
  treasuryFeeRevenueAnnual: number;
  totalRelationshipValueAnnual: number | null;
  impliedLoanSpreadAdjustmentBps: number; // how much spread can be tightened
  pricingNarrative: string; // human-readable summary
  complianceNote: string; // always include Section 106 note
};

export function analyzeRelationshipPricing(params: {
  loanAmount: number | null;
  loanSpreadBps: number | null;
  depositProfile: DepositProfile | null;
  treasuryProposals: TreasuryProposal[];
}): RelationshipPricingAnalysis {
  const { loanAmount, loanSpreadBps, depositProfile, treasuryProposals } =
    params;

  const loanSpreadContributionBps = loanSpreadBps;

  const depositEarningsCreditAnnual =
    depositProfile?.depositRelationshipValue ?? null;

  const treasuryFeeRevenueAnnual = treasuryProposals
    .filter((p) => p.recommended)
    .reduce((sum, p) => sum + p.estimatedAnnualFee, 0);

  // Loan spread income = loanAmount * loanSpreadBps / 10000
  const loanSpreadIncome =
    loanAmount !== null && loanSpreadBps !== null
      ? (loanAmount * loanSpreadBps) / 10000
      : null;

  // Total relationship value = loan spread income + deposit EC + treasury fees
  let totalRelationshipValueAnnual: number | null = null;
  if (
    loanSpreadIncome !== null ||
    depositEarningsCreditAnnual !== null ||
    treasuryFeeRevenueAnnual > 0
  ) {
    totalRelationshipValueAnnual =
      (loanSpreadIncome ?? 0) +
      (depositEarningsCreditAnnual ?? 0) +
      treasuryFeeRevenueAnnual;
  }

  // Implied loan spread adjustment from deposit relationship
  let impliedLoanSpreadAdjustmentBps = 0;
  if (
    depositEarningsCreditAnnual !== null &&
    depositEarningsCreditAnnual > 0 &&
    loanAmount !== null &&
    loanAmount > 0
  ) {
    impliedLoanSpreadAdjustmentBps = Math.floor(
      (depositEarningsCreditAnnual / loanAmount) * 10000
    );
  }

  // Build pricing narrative
  const parts: string[] = [];
  if (totalRelationshipValueAnnual !== null) {
    parts.push(
      `Total relationship value estimated at $${fmt(totalRelationshipValueAnnual)}/year`
    );
    const breakdown: string[] = [];
    if (loanSpreadIncome !== null)
      breakdown.push(`loan: $${fmt(loanSpreadIncome)}`);
    if (depositEarningsCreditAnnual !== null)
      breakdown.push(`deposits: $${fmt(depositEarningsCreditAnnual)}`);
    if (treasuryFeeRevenueAnnual > 0)
      breakdown.push(`treasury: $${fmt(treasuryFeeRevenueAnnual)}`);
    if (breakdown.length > 0) parts[0] += ` (${breakdown.join(", ")})`;
    parts[0] += ".";
  } else {
    parts.push("Insufficient data to estimate total relationship value.");
  }

  if (impliedLoanSpreadAdjustmentBps > 0) {
    parts.push(
      `Deposit relationship supports ${impliedLoanSpreadAdjustmentBps} bps of loan spread flexibility.`
    );
  }

  const pricingNarrative = parts.join(" ");

  const complianceNote =
    "Treasury and deposit products are recommended based on borrower operational need, " +
    "not as a condition of credit. This analysis does not constitute tying under " +
    "Bank Holding Company Act Section 106.";

  return {
    loanSpreadContributionBps,
    depositEarningsCreditAnnual,
    treasuryFeeRevenueAnnual,
    totalRelationshipValueAnnual,
    impliedLoanSpreadAdjustmentBps,
    pricingNarrative,
    complianceNote,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
