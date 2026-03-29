/**
 * Phase 56 — Efficiency Ratios (Pure, Deterministic)
 *
 * Verified against FinanceToolkit published formulas.
 * No LLM. No DB.
 */

/** Days Sales Outstanding */
export function computeDSO(accountsReceivable: number, revenue: number, days = 365): number {
  if (revenue === 0) return 0;
  return (accountsReceivable / revenue) * days;
}

/** Days Inventory Outstanding */
export function computeDIO(inventory: number, cogs: number, days = 365): number {
  if (cogs === 0) return 0;
  return (inventory / cogs) * days;
}

/** Days Payable Outstanding */
export function computeDPO(accountsPayable: number, cogs: number, days = 365): number {
  if (cogs === 0) return 0;
  return (accountsPayable / cogs) * days;
}

/** Cash Conversion Cycle = DSO + DIO - DPO */
export function computeCCC(dso: number, dio: number, dpo: number): number {
  return dso + dio - dpo;
}

/** Asset Turnover */
export function computeAssetTurnover(revenue: number, avgTotalAssets: number): number {
  if (avgTotalAssets === 0) return 0;
  return revenue / avgTotalAssets;
}

/** Fixed Asset Turnover */
export function computeFixedAssetTurnover(revenue: number, netFixedAssets: number): number {
  if (netFixedAssets === 0) return 0;
  return revenue / netFixedAssets;
}

/** Working Capital as % of Revenue */
export function computeWorkingCapitalPct(
  currentAssets: number,
  currentLiabilities: number,
  revenue: number,
): number {
  if (revenue === 0) return 0;
  return (currentAssets - currentLiabilities) / revenue;
}
