/**
 * Pure collateral LTV computation — no DB, no server-only.
 * Replaces banker-facing "Collateral Coverage" with policy-based LTV.
 *
 * LTV = loan_amount / total_lendable_value (NOT gross_value)
 */

import { resolveAdvanceRate } from "@/lib/collateral/collateralTypes";

import type { CollateralItem } from "./builderTypes";

export type CollateralLtvSummary = {
  totalGrossValue: number;
  totalLendableValue: number;
  ltv: number | null;
  policyLimit: number | null;
  withinPolicy: boolean | null;
};

/*
 * Advance rates come from src/lib/collateral/collateralTypes.ts, the one
 * contract the credit memo also reads.
 *
 * This module used to keep its own table, and it had drifted to the same
 * dead vocabulary the memo's copy had before #1022 fixed that one: keyed on
 * `blanket_lien` where the classifiers emit `ucc_lien`, `other` where they
 * emit `general`, and missing `insurance_backed` and `purchase_target`
 * entirely — each falling through a silent `?? 0.50`. So the rate a banker
 * read in the builder was not the rate the memo underwrote to. One table now,
 * shared, and `null` where this system has no defensible default rather than
 * a guess dressed up as a policy number.
 */

/** Default policy LTV limit (can be overridden by bank policy later) */
const DEFAULT_POLICY_LTV_LIMIT = 0.80;

/**
 * Compute lendable value for a single collateral item.
 *
 * An item with no usable rate — an unrecognised type, a type carrying no
 * defensible default, or a stored rate outside [0, 1] — lends nothing. It is
 * left out of the total rather than admitted at an invented number, which
 * matches how the credit memo treats the same item.
 */
export function computeItemLendableValue(item: CollateralItem): number {
  const rate = getEffectiveAdvanceRate(item);
  if (rate === null) return 0;
  return (item.estimated_value ?? 0) * rate;
}

/**
 * Get the effective advance rate for an item, or null when this system has no
 * rate it can defend for it. Callers must show the absence — never fill it.
 */
export function getEffectiveAdvanceRate(item: CollateralItem): number | null {
  const resolution = resolveAdvanceRate(item);
  return resolution.status === "explicit" || resolution.status === "default"
    ? resolution.rate
    : null;
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
