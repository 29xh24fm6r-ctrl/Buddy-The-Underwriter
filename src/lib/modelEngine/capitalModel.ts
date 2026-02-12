/**
 * Model Engine V2 — Capital Model (Phase 1)
 *
 * Basic debt/leverage computation.
 * No stress testing, no scenario engine, no amortization schedules.
 */

import type {
  FinancialModel,
  LoanAssumptions,
  CapitalModelResult,
} from "./types";

/**
 * Compute basic capital model metrics from the financial model.
 *
 * Uses the most recent period for balance sheet data
 * and the most recent period with EBITDA for leverage.
 */
export function computeCapitalModel(
  model: FinancialModel,
  assumptions?: LoanAssumptions,
): CapitalModelResult {
  if (model.periods.length === 0) {
    return { totalDebt: null, baseDebtService: null, leverage: null };
  }

  // Use latest period
  const latest = model.periods[model.periods.length - 1];

  // Total debt = short-term + long-term
  const shortTerm = latest.balance.shortTermDebt ?? 0;
  const longTerm = latest.balance.longTermDebt ?? 0;
  const totalDebt = shortTerm + longTerm;

  // Base debt service (simple annual interest if assumptions provided)
  let baseDebtService: number | null = null;
  if (assumptions?.loanAmount && assumptions?.interestRate) {
    baseDebtService = assumptions.loanAmount * (assumptions.interestRate / 100);
  }

  // Leverage = totalDebt / EBITDA
  let leverage: number | null = null;
  if (latest.cashflow.ebitda && latest.cashflow.ebitda > 0 && totalDebt > 0) {
    leverage = totalDebt / latest.cashflow.ebitda;
  }

  return { totalDebt, baseDebtService, leverage };
}
