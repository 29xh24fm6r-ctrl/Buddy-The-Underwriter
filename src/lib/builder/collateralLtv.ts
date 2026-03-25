/**
 * Pure collateral LTV computation — no DB, no server-only.
 * Replaces banker-facing "Collateral Coverage" with policy-based LTV.
 *
 * LTV = loan_amount / total_lendable_value (NOT gross_value)
 */

import type { CollateralItem } from "./builderTypes";

export type CollateralLtvSummary = {
  totalGrossValue: number;
  totalLendableValue: number;
  ltv: number | null;
  policyLimit: number | null;
  withinPolicy: boolean | null;
};

/** Default advance rates by collateral type when none explicitly set */
const DEFAULT_ADVANCE_RATES: Record<string, number> = {
  real_estate: 0.80,
  equipment: 0.75,
  accounts_receivable: 0.80,
  inventory: 0.50,
  blanket_lien: 0.70,
  vehicle: 0.75,
  other: 0.50,
};

/** Default policy LTV limit (can be overridden by bank policy later) */
const DEFAULT_POLICY_LTV_LIMIT = 0.80;

/**
 * Compute lendable value for a single collateral item.
 * advance_rate from item takes precedence, then default by type.
 */
export function computeItemLendableValue(item: CollateralItem): number {
  const grossValue = item.estimated_value ?? 0;
  const advanceRate = item.advance_rate ?? DEFAULT_ADVANCE_RATES[item.item_type] ?? 0.50;
  return grossValue * advanceRate;
}

/**
 * Get effective advance rate for an item.
 */
export function getEffectiveAdvanceRate(item: CollateralItem): number {
  return item.advance_rate ?? DEFAULT_ADVANCE_RATES[item.item_type] ?? 0.50;
}

/**
 * Compute aggregate LTV summary for all collateral items against a loan amount.
 */
export function computeCollateralLtv(
  collateral: CollateralItem[],
  requestedLoanAmount: number,
  policyLtvLimit?: number,
): CollateralLtvSummary {
  const totalGrossValue = collateral.reduce(
    (sum, c) => sum + (c.estimated_value ?? 0),
    0,
  );

  const totalLendableValue = collateral.reduce(
    (sum, c) => sum + computeItemLendableValue(c),
    0,
  );

  const ltv =
    totalLendableValue > 0 && requestedLoanAmount > 0
      ? requestedLoanAmount / totalLendableValue
      : null;

  const limit = policyLtvLimit ?? DEFAULT_POLICY_LTV_LIMIT;

  return {
    totalGrossValue,
    totalLendableValue,
    ltv,
    policyLimit: limit,
    withinPolicy: ltv !== null ? ltv <= limit : null,
  };
}
