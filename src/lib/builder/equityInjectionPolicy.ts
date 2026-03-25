/**
 * Pure equity injection policy logic — no DB, no server-only.
 * Derives equity amounts from percentages and evaluates policy compliance.
 */

import type { EquityRequirementSource } from "./builderTypes";

export type EquityEvaluation = {
  requiredPct: number;
  actualPct: number | null;
  requiredAmount: number;
  actualAmount: number | null;
  source: EquityRequirementSource;
  withinPolicy: boolean;
  shortfallAmount: number | null;
};

/** Default equity requirement by product type (placeholder until bank policy engine) */
const DEFAULT_EQUITY_REQUIREMENTS: Record<string, number> = {
  sba_7a: 0.10,
  sba_504: 0.10,
  cre_mortgage: 0.20,
  construction: 0.25,
  equipment: 0.10,
  acquisition: 0.20,
  term_loan: 0.15,
  line_of_credit: 0.00,
  ci_loan: 0.15,
  usda_b_and_i: 0.10,
  other: 0.15,
};

/**
 * Get default equity requirement percentage for a loan type.
 */
export function getDefaultEquityRequirement(loanType: string | undefined): number {
  if (!loanType) return 0.15;
  return DEFAULT_EQUITY_REQUIREMENTS[loanType] ?? 0.15;
}

/**
 * Compute equity evaluation from builder inputs.
 *
 * @param baseTransactionAmount - The total financed transaction (e.g. purchase price, project cost)
 * @param loanType - Used to look up default required %
 * @param overrideRequiredPct - Bank policy or manual override for required %
 * @param actualPct - Banker-entered proposed equity %
 * @param actualAmount - Banker-entered proposed equity $ (used if % not provided)
 */
export function evaluateEquityInjection(args: {
  baseTransactionAmount: number;
  loanType?: string;
  overrideRequiredPct?: number | null;
  actualPct?: number | null;
  actualAmount?: number | null;
  source?: EquityRequirementSource;
}): EquityEvaluation {
  const requiredPct =
    args.overrideRequiredPct ?? getDefaultEquityRequirement(args.loanType);

  const source: EquityRequirementSource =
    args.source ??
    (args.overrideRequiredPct != null ? "manual_override" : "product_default");

  const requiredAmount = args.baseTransactionAmount * requiredPct;

  // Derive actual from % or $ (percent-first)
  let actualPct = args.actualPct ?? null;
  let actualAmount = args.actualAmount ?? null;

  if (actualPct != null && args.baseTransactionAmount > 0) {
    actualAmount = args.baseTransactionAmount * actualPct;
  } else if (actualAmount != null && args.baseTransactionAmount > 0) {
    actualPct = actualAmount / args.baseTransactionAmount;
  }

  const withinPolicy =
    actualAmount != null ? actualAmount >= requiredAmount : false;

  const shortfallAmount =
    actualAmount != null && actualAmount < requiredAmount
      ? requiredAmount - actualAmount
      : null;

  return {
    requiredPct,
    actualPct,
    requiredAmount,
    actualAmount,
    source,
    withinPolicy,
    shortfallAmount,
  };
}
