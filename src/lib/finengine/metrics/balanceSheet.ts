/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — Phase 1: balance-sheet diagnostic spread.
 *
 * Liquidity completion · activity/turnover (days-on-hand family) · balance-sheet
 * leverage/solvency. Pure functions returning MetricResult, matching ratios.ts.
 * Turnover/return metrics use two-period AVERAGE balances (avgBalance) where the
 * denominator is a balance-sheet stock. Diagnostic metrics carry no hard floor;
 * leverage caps resolve from the registry (NG3).
 */

import type { MetricResult, PolicyContext } from "@/lib/finengine/contracts";
import { div, avgBalance, withFloor } from "@/lib/finengine/metrics/helpers";

const DAYS = 365;
const z = (v: number | null | undefined): number => (v == null ? 0 : v);

/** Build a diagnostic (no-floor) MetricResult. */
function m(metric: string, value: number | null, inputs: Record<string, number>, explanation: string): MetricResult {
  return { metric, value, inputs, explanation };
}

// ---------------------------------------------------------------------------
// Liquidity completion
// ---------------------------------------------------------------------------

export function cashRatio(cashAndEquivalents: number | null, currentLiabilities: number | null, ctx?: PolicyContext): MetricResult {
  return withFloor(
    m("CASH_RATIO", div(cashAndEquivalents, currentLiabilities), { cashAndEquivalents: z(cashAndEquivalents), currentLiabilities: z(currentLiabilities) },
      "Cash ratio = (cash + equivalents) ÷ current liabilities — cash-only coverage of near-term obligations."),
    "quick_ratio_min", ctx,
  );
}

export function netWorkingCapital(currentAssets: number | null, currentLiabilities: number | null): MetricResult {
  const value = currentAssets == null && currentLiabilities == null ? null : z(currentAssets) - z(currentLiabilities);
  return m("NET_WORKING_CAPITAL", value, { currentAssets: z(currentAssets), currentLiabilities: z(currentLiabilities) },
    "Net working capital = current assets − current liabilities (dollar cushion funding the operating cycle).");
}

export function defensiveInterval(cash: number | null, marketableSecurities: number | null, receivables: number | null, dailyOperatingCashUse: number | null): MetricResult {
  const defensiveAssets = z(cash) + z(marketableSecurities) + z(receivables);
  return m("DEFENSIVE_INTERVAL_DAYS", div(defensiveAssets, dailyOperatingCashUse),
    { cash: z(cash), marketableSecurities: z(marketableSecurities), receivables: z(receivables), dailyOperatingCashUse: z(dailyOperatingCashUse) },
    "Defensive interval = (cash + marketable securities + receivables) ÷ daily operating cash use — survival runway with no new inflows.");
}

export function workingCapitalToSales(netWorkingCapitalValue: number | null, revenue: number | null): MetricResult {
  return m("WC_TO_SALES", div(netWorkingCapitalValue, revenue), { netWorkingCapital: z(netWorkingCapitalValue), revenue: z(revenue) },
    "Working capital ÷ sales — working-capital intensity of revenue.");
}

// ---------------------------------------------------------------------------
// Activity / turnover (days-on-hand family)
// ---------------------------------------------------------------------------

export function arTurnover(netCreditSales: number | null, arBeginning: number | null, arEnding: number | null): MetricResult {
  const avgAr = avgBalance(arBeginning, arEnding);
  return m("AR_TURNOVER", div(netCreditSales, avgAr), { netCreditSales: z(netCreditSales), avgAr: z(avgAr) },
    "AR turnover = net credit sales ÷ average AR — how many times receivables are collected per year.");
}

export function daysSalesOutstanding(ar: number | null, creditSales: number | null): MetricResult {
  const ratio = div(ar, creditSales);
  return m("DSO", ratio == null ? null : ratio * DAYS, { ar: z(ar), creditSales: z(creditSales) },
    "DSO = (AR ÷ credit sales) × 365 — average days to collect receivables.");
}

export function inventoryTurnover(cogs: number | null, invBeginning: number | null, invEnding: number | null): MetricResult {
  const avgInv = avgBalance(invBeginning, invEnding);
  return m("INVENTORY_TURNOVER", div(cogs, avgInv), { cogs: z(cogs), avgInventory: z(avgInv) },
    "Inventory turnover = COGS ÷ average inventory.");
}

export function daysInventoryOnHand(inventory: number | null, cogs: number | null): MetricResult {
  const ratio = div(inventory, cogs);
  return m("DIO", ratio == null ? null : ratio * DAYS, { inventory: z(inventory), cogs: z(cogs) },
    "DIO = (inventory ÷ COGS) × 365 — average days inventory is held.");
}

export function apTurnover(cogsOrPurchases: number | null, apBeginning: number | null, apEnding: number | null): MetricResult {
  const avgAp = avgBalance(apBeginning, apEnding);
  return m("AP_TURNOVER", div(cogsOrPurchases, avgAp), { cogsOrPurchases: z(cogsOrPurchases), avgAp: z(avgAp) },
    "AP turnover = COGS (or purchases) ÷ average AP.");
}

export function daysPayableOutstanding(ap: number | null, cogs: number | null): MetricResult {
  const ratio = div(ap, cogs);
  return m("DPO", ratio == null ? null : ratio * DAYS, { ap: z(ap), cogs: z(cogs) },
    "DPO = (AP ÷ COGS) × 365 — average days to pay suppliers. Rising DPO can be an early-distress tell (stretching payables).");
}

export function operatingCycle(dso: number | null, dio: number | null): MetricResult {
  const value = dso == null && dio == null ? null : z(dso) + z(dio);
  return m("OPERATING_CYCLE_DAYS", value, { dso: z(dso), dio: z(dio) }, "Operating cycle = DSO + DIO.");
}

export function cashConversionCycle(dso: number | null, dio: number | null, dpo: number | null): MetricResult {
  const value = dso == null && dio == null && dpo == null ? null : z(dso) + z(dio) - z(dpo);
  return m("CASH_CONVERSION_CYCLE", value, { dso: z(dso), dio: z(dio), dpo: z(dpo) },
    "Cash conversion cycle = DSO + DIO − DPO — days cash is locked in operations.");
}

export function assetTurnover(revenue: number | null, taBeginning: number | null, taEnding: number | null): MetricResult {
  const avgTa = avgBalance(taBeginning, taEnding);
  return m("ASSET_TURNOVER", div(revenue, avgTa), { revenue: z(revenue), avgTotalAssets: z(avgTa) },
    "Asset turnover = revenue ÷ average total assets.");
}

export function fixedAssetTurnover(revenue: number | null, nfaBeginning: number | null, nfaEnding: number | null): MetricResult {
  const avgNfa = avgBalance(nfaBeginning, nfaEnding);
  return m("FIXED_ASSET_TURNOVER", div(revenue, avgNfa), { revenue: z(revenue), avgNetFixedAssets: z(avgNfa) },
    "Fixed-asset turnover = revenue ÷ average net fixed assets.");
}

export function workingCapitalTurnover(revenue: number | null, wcBeginning: number | null, wcEnding: number | null): MetricResult {
  const avgWc = avgBalance(wcBeginning, wcEnding);
  return m("WC_TURNOVER", div(revenue, avgWc), { revenue: z(revenue), avgWorkingCapital: z(avgWc) },
    "Working-capital turnover = revenue ÷ average working capital.");
}

// ---------------------------------------------------------------------------
// Balance-sheet leverage / solvency
// ---------------------------------------------------------------------------

export function debtToEquity(totalLiabilities: number | null, equity: number | null, ctx?: PolicyContext): MetricResult {
  return withFloor(
    m("DEBT_TO_EQUITY", div(totalLiabilities, equity), { totalLiabilities: z(totalLiabilities), equity: z(equity) },
      "Debt/equity = total liabilities ÷ equity — creditor vs owner money."),
    "debt_to_equity_max", ctx,
  );
}

export function debtToWorth(totalLiabilities: number | null, netWorth: number | null, ctx?: PolicyContext): MetricResult {
  return withFloor(
    m("DEBT_TO_WORTH", div(totalLiabilities, netWorth), { totalLiabilities: z(totalLiabilities), netWorth: z(netWorth) },
      "Debt/worth = total liabilities ÷ net worth — the loss cushion behind creditors."),
    "debt_to_worth_max", ctx,
  );
}

export function debtToAssets(fundedDebt: number | null, totalAssets: number | null, ctx?: PolicyContext): MetricResult {
  return withFloor(
    m("DEBT_TO_ASSETS", div(fundedDebt, totalAssets), { fundedDebt: z(fundedDebt), totalAssets: z(totalAssets) },
      "Debt/assets = funded (interest-bearing) debt ÷ total assets."),
    "debt_to_assets_max", ctx,
  );
}

export function liabilitiesToAssets(totalLiabilities: number | null, totalAssets: number | null): MetricResult {
  return m("LIABILITIES_TO_ASSETS", div(totalLiabilities, totalAssets), { totalLiabilities: z(totalLiabilities), totalAssets: z(totalAssets) },
    "Total liabilities ÷ total assets — share of assets financed by all liabilities.");
}

export function debtToCapital(debt: number | null, equity: number | null): MetricResult {
  const cap = z(debt) + z(equity);
  return m("DEBT_TO_CAPITAL", div(debt, cap === 0 ? null : cap), { debt: z(debt), equity: z(equity) },
    "Debt/capital = debt ÷ (debt + equity).");
}

export function ltdToCapital(longTermDebt: number | null, equity: number | null): MetricResult {
  const cap = z(longTermDebt) + z(equity);
  return m("LTD_TO_CAPITAL", div(longTermDebt, cap === 0 ? null : cap), { longTermDebt: z(longTermDebt), equity: z(equity) },
    "LTD/capital = long-term debt ÷ (long-term debt + equity).");
}

export function equityRatio(equity: number | null, totalAssets: number | null): MetricResult {
  return m("EQUITY_RATIO", div(equity, totalAssets), { equity: z(equity), totalAssets: z(totalAssets) },
    "Equity ratio = equity ÷ total assets — owner-funded share of the balance sheet.");
}

export function equityMultiplier(totalAssets: number | null, equity: number | null): MetricResult {
  return m("EQUITY_MULTIPLIER", div(totalAssets, equity), { totalAssets: z(totalAssets), equity: z(equity) },
    "Equity multiplier = total assets ÷ equity — the leverage factor in DuPont ROE.");
}
