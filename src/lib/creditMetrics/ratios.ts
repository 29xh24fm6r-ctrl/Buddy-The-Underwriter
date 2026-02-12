/**
 * Credit Metrics — Core Credit Ratios
 *
 * Seven deterministic credit ratios with full explainability.
 * Every ratio returns MetricResult with inputs, formula, and diagnostics.
 *
 * PHASE 4A: Analytics foundation only.
 */

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { CoreCreditMetrics, DebtServiceResult, MetricResult } from "./types";
import { buildDiagnostics, safeDivide, safeSum } from "./explain";

// ---------------------------------------------------------------------------
// Individual ratio helpers
// ---------------------------------------------------------------------------

function computeDscr(
  ebitda: number | undefined,
  totalDebtService: number | undefined,
): MetricResult {
  const inputs: Record<string, number | undefined> = { ebitda, totalDebtService };
  return safeDivide("ebitda", ebitda, "totalDebtService", totalDebtService, inputs, "EBITDA / TotalDebtService");
}

function computeLeverage(
  shortTermDebt: number | undefined,
  longTermDebt: number | undefined,
  ebitda: number | undefined,
): MetricResult {
  const inputs: Record<string, number | undefined> = { shortTermDebt, longTermDebt, ebitda };
  const { value: totalDebt, missing } = safeSum({ shortTermDebt, longTermDebt });

  if (totalDebt === undefined) {
    return {
      value: undefined,
      inputs,
      formula: "(ShortTermDebt + LongTermDebt) / EBITDA",
      diagnostics: { missingInputs: missing },
    };
  }

  return safeDivide(
    "totalDebt", totalDebt,
    "ebitda", ebitda,
    { ...inputs, totalDebt },
    "(ShortTermDebt + LongTermDebt) / EBITDA",
  );
}

function computeCurrentRatio(
  cash: number | undefined,
  accountsReceivable: number | undefined,
  inventory: number | undefined,
  shortTermDebt: number | undefined,
): MetricResult {
  const inputs: Record<string, number | undefined> = { cash, accountsReceivable, inventory, shortTermDebt };
  const { value: currentAssets, missing } = safeSum({ cash, accountsReceivable, inventory });

  if (currentAssets === undefined) {
    return {
      value: undefined,
      inputs,
      formula: "(Cash + AccountsReceivable + Inventory) / ShortTermDebt",
      diagnostics: { missingInputs: missing },
    };
  }

  return safeDivide(
    "currentAssets", currentAssets,
    "shortTermDebt", shortTermDebt,
    { ...inputs, currentAssets },
    "(Cash + AccountsReceivable + Inventory) / ShortTermDebt",
  );
}

function computeQuickRatio(
  cash: number | undefined,
  accountsReceivable: number | undefined,
  shortTermDebt: number | undefined,
): MetricResult {
  const inputs: Record<string, number | undefined> = { cash, accountsReceivable, shortTermDebt };
  const { value: quickAssets, missing } = safeSum({ cash, accountsReceivable });

  if (quickAssets === undefined) {
    return {
      value: undefined,
      inputs,
      formula: "(Cash + AccountsReceivable) / ShortTermDebt",
      diagnostics: { missingInputs: missing },
    };
  }

  return safeDivide(
    "quickAssets", quickAssets,
    "shortTermDebt", shortTermDebt,
    { ...inputs, quickAssets },
    "(Cash + AccountsReceivable) / ShortTermDebt",
  );
}

function computeWorkingCapital(
  cash: number | undefined,
  accountsReceivable: number | undefined,
  inventory: number | undefined,
  shortTermDebt: number | undefined,
): MetricResult {
  const inputs: Record<string, number | undefined> = { cash, accountsReceivable, inventory, shortTermDebt };
  const formula = "(Cash + AccountsReceivable + Inventory) - ShortTermDebt";

  const { value: currentAssets, missing: assetsMissing } = safeSum({ cash, accountsReceivable, inventory });

  if (currentAssets === undefined || shortTermDebt === undefined) {
    const allMissing = [...assetsMissing];
    if (shortTermDebt === undefined) allMissing.push("shortTermDebt");
    return {
      value: undefined,
      inputs,
      formula,
      diagnostics: { missingInputs: allMissing },
    };
  }

  return {
    value: currentAssets - shortTermDebt,
    inputs: { ...inputs, currentAssets },
    formula,
  };
}

function computeEbitdaMargin(
  ebitda: number | undefined,
  revenue: number | undefined,
): MetricResult {
  const inputs: Record<string, number | undefined> = { ebitda, revenue };
  return safeDivide("ebitda", ebitda, "revenue", revenue, inputs, "EBITDA / Revenue");
}

function computeNetMargin(
  netIncome: number | undefined,
  revenue: number | undefined,
): MetricResult {
  const inputs: Record<string, number | undefined> = { netIncome, revenue };
  return safeDivide("netIncome", netIncome, "revenue", revenue, inputs, "NetIncome / Revenue");
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Compute all core credit metrics for a specific period.
 *
 * Pure function — deterministic, no side effects.
 */
export function computeCoreCreditMetrics(
  model: FinancialModel,
  periodId: string,
  debtService: DebtServiceResult,
): CoreCreditMetrics {
  const period = model.periods.find((p) => p.periodId === periodId);

  if (!period) {
    return { periodId, metrics: {} };
  }

  const { income, balance, cashflow } = period;

  return {
    periodId,
    metrics: {
      dscr: computeDscr(cashflow.ebitda, debtService.totalDebtService),
      leverageDebtToEbitda: computeLeverage(balance.shortTermDebt, balance.longTermDebt, cashflow.ebitda),
      currentRatio: computeCurrentRatio(balance.cash, balance.accountsReceivable, balance.inventory, balance.shortTermDebt),
      quickRatio: computeQuickRatio(balance.cash, balance.accountsReceivable, balance.shortTermDebt),
      workingCapital: computeWorkingCapital(balance.cash, balance.accountsReceivable, balance.inventory, balance.shortTermDebt),
      ebitdaMargin: computeEbitdaMargin(cashflow.ebitda, income.revenue),
      netMargin: computeNetMargin(income.netIncome, income.revenue),
    },
  };
}
