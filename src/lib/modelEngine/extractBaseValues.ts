/**
 * Extract base metric values from the latest period of a FinancialModel.
 *
 * Shared helper — used by engineAuthority, persistModelV2SnapshotFromDeal,
 * and the replay route. Must remain deterministic — pure function only.
 */

import type { FinancialModel } from "./types";

export function extractBaseValues(
  model: FinancialModel,
  overrides?: { annualDebtService?: number | null },
): Record<string, number | null> {
  const baseValues: Record<string, number | null> = {};
  if (model.periods.length === 0) return baseValues;

  const latest = model.periods[model.periods.length - 1];

  // Income statement
  if (latest.income.revenue !== undefined) baseValues["REVENUE"] = latest.income.revenue;
  if (latest.income.cogs !== undefined) baseValues["COGS"] = latest.income.cogs;
  if (latest.income.netIncome !== undefined) baseValues["NET_INCOME"] = latest.income.netIncome;
  if (latest.income.operatingExpenses !== undefined) baseValues["OPERATING_EXPENSES"] = latest.income.operatingExpenses;
  if (latest.income.revenue !== undefined && latest.income.cogs !== undefined) {
    baseValues["GROSS_PROFIT"] = latest.income.revenue - latest.income.cogs;
  }

  // Balance sheet
  if (latest.balance.totalAssets !== undefined) baseValues["TOTAL_ASSETS"] = latest.balance.totalAssets;
  if (latest.balance.totalLiabilities !== undefined) baseValues["TOTAL_LIABILITIES"] = latest.balance.totalLiabilities;
  if (latest.balance.equity !== undefined) baseValues["EQUITY"] = latest.balance.equity;
  if (latest.balance.shortTermDebt !== undefined || latest.balance.longTermDebt !== undefined) {
    baseValues["TOTAL_DEBT"] = (latest.balance.shortTermDebt ?? 0) + (latest.balance.longTermDebt ?? 0);
  }

  const currentAssets = (latest.balance.cash ?? 0) + (latest.balance.accountsReceivable ?? 0) + (latest.balance.inventory ?? 0);
  if (currentAssets > 0) baseValues["CURRENT_ASSETS"] = currentAssets;
  if (latest.balance.shortTermDebt !== undefined) baseValues["CURRENT_LIABILITIES"] = latest.balance.shortTermDebt;

  // Cash flow
  if (latest.cashflow.ebitda !== undefined) {
    baseValues["EBITDA"] = latest.cashflow.ebitda;
  }
  if (latest.cashflow.cfads !== undefined) {
    // Emit under BOTH keys — seed formula uses CFADS, string registry uses CASH_FLOW_AVAILABLE
    baseValues["CFADS"] = latest.cashflow.cfads;
    baseValues["CASH_FLOW_AVAILABLE"] = latest.cashflow.cfads;
  } else if (latest.cashflow.ebitda !== undefined) {
    // Fall back to EBITDA when CFADS unavailable
    baseValues["CASH_FLOW_AVAILABLE"] = latest.cashflow.ebitda;
  }

  // Interest expense — for FCCR / interest coverage calcs, NOT DSCR denominator
  if (latest.income.interest !== undefined) {
    baseValues["INTEREST_EXPENSE"] = latest.income.interest;
  }

  // ADS from pricing — the real DSCR denominator
  if (overrides?.annualDebtService != null && isFinite(overrides.annualDebtService)) {
    baseValues["ANNUAL_DEBT_SERVICE"] = overrides.annualDebtService;
  }

  return baseValues;
}
