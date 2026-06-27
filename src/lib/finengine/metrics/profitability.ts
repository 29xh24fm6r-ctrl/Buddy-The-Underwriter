/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — Phase 2: profitability — margins, returns, DuPont.
 *
 * Pure functions returning MetricResult (margins/returns) and a structured
 * DuPontResult that surfaces WHICH factor drives ROE (margin vs efficiency vs
 * leverage) — leverage-driven ROE is the lower-quality, higher-risk case. Returns
 * use two-period average balances. Diagnostic (no hard floors).
 */

import type { MetricResult } from "@/lib/finengine/contracts";
import { div, avgBalance } from "@/lib/finengine/metrics/helpers";

const z = (v: number | null | undefined): number => (v == null ? 0 : v);
function m(metric: string, value: number | null, inputs: Record<string, number>, explanation: string): MetricResult {
  return { metric, value, inputs, explanation };
}

// ---- Margins (÷ revenue) ---------------------------------------------------

export function grossMargin(grossProfit: number | null, revenue: number | null): MetricResult {
  return m("GROSS_MARGIN", div(grossProfit, revenue), { grossProfit: z(grossProfit), revenue: z(revenue) }, "Gross margin = gross profit ÷ revenue — pricing power / production efficiency.");
}
export function operatingMargin(operatingIncome: number | null, revenue: number | null): MetricResult {
  return m("OPERATING_MARGIN", div(operatingIncome, revenue), { operatingIncome: z(operatingIncome), revenue: z(revenue) }, "Operating margin = operating income ÷ revenue.");
}
export function netMargin(netIncome: number | null, revenue: number | null): MetricResult {
  return m("NET_MARGIN", div(netIncome, revenue), { netIncome: z(netIncome), revenue: z(revenue) }, "Net margin = net income ÷ revenue.");
}
export function ebitdaMargin(ebitda: number | null, revenue: number | null): MetricResult {
  return m("EBITDA_MARGIN", div(ebitda, revenue), { ebitda: z(ebitda), revenue: z(revenue) }, "EBITDA margin = EBITDA ÷ revenue.");
}
export function pretaxMargin(pretaxIncome: number | null, revenue: number | null): MetricResult {
  return m("PRETAX_MARGIN", div(pretaxIncome, revenue), { pretaxIncome: z(pretaxIncome), revenue: z(revenue) }, "Pretax margin = pretax income ÷ revenue.");
}
export function operatingExpenseRatio(operatingExpenses: number | null, revenue: number | null): MetricResult {
  return m("OPEX_RATIO", div(operatingExpenses, revenue), { operatingExpenses: z(operatingExpenses), revenue: z(revenue) }, "Operating-expense ratio = operating expenses ÷ revenue.");
}

// ---- Returns (÷ average balance) ------------------------------------------

export function returnOnAssets(netIncome: number | null, taBeginning: number | null, taEnding: number | null): MetricResult {
  const avgTa = avgBalance(taBeginning, taEnding);
  return m("ROA", div(netIncome, avgTa), { netIncome: z(netIncome), avgTotalAssets: z(avgTa) }, "ROA = net income ÷ average total assets.");
}
export function returnOnEquity(netIncome: number | null, eqBeginning: number | null, eqEnding: number | null): MetricResult {
  const avgEq = avgBalance(eqBeginning, eqEnding);
  return m("ROE", div(netIncome, avgEq), { netIncome: z(netIncome), avgEquity: z(avgEq) }, "ROE = net income ÷ average equity.");
}
export function returnOnInvestedCapital(nopat: number | null, investedCapital: number | null): MetricResult {
  return m("ROIC", div(nopat, investedCapital), { nopat: z(nopat), investedCapital: z(investedCapital) }, "ROIC = NOPAT ÷ invested capital.");
}
export function returnOnCapitalEmployed(ebit: number | null, capitalEmployed: number | null): MetricResult {
  return m("ROCE", div(ebit, capitalEmployed), { ebit: z(ebit), capitalEmployed: z(capitalEmployed) }, "ROCE = EBIT ÷ capital employed.");
}

// ---- DuPont decomposition --------------------------------------------------

export type DuPontDriver = "margin" | "efficiency" | "leverage";

export type DuPontResult = {
  metric: "ROE_DUPONT";
  steps: 3 | 5;
  roe: number | null; // reconstructed product
  factors: Record<string, number | null>;
  driver: DuPontDriver | null;
  explanation: string;
};

/** Deterministic driver: the factor with the largest lift over a neutral baseline. */
function classifyDriver(netMarginV: number | null, assetTurnoverV: number | null, equityMultiplierV: number | null): DuPontDriver | null {
  if (netMarginV == null || assetTurnoverV == null || equityMultiplierV == null) return null;
  const marginLift = netMarginV / 0.05; // 5% baseline net margin
  const efficiencyLift = assetTurnoverV / 1.0; // 1.0x baseline asset turnover
  const leverageLift = equityMultiplierV / 2.0; // 2.0x baseline equity multiplier
  const max = Math.max(marginLift, efficiencyLift, leverageLift);
  if (max === leverageLift) return "leverage";
  if (max === marginLift) return "margin";
  return "efficiency";
}

/** 3-step DuPont: ROE = net margin × asset turnover × equity multiplier. */
export function dupont3(netMarginV: number | null, assetTurnoverV: number | null, equityMultiplierV: number | null): DuPontResult {
  const roe = netMarginV == null || assetTurnoverV == null || equityMultiplierV == null ? null : netMarginV * assetTurnoverV * equityMultiplierV;
  return {
    metric: "ROE_DUPONT", steps: 3, roe,
    factors: { netMargin: netMarginV, assetTurnover: assetTurnoverV, equityMultiplier: equityMultiplierV },
    driver: classifyDriver(netMarginV, assetTurnoverV, equityMultiplierV),
    explanation: "ROE = net margin × asset turnover × equity multiplier. Leverage-driven ROE (equity multiplier dominant) is lower-quality.",
  };
}

/**
 * 5-step DuPont: ROE = tax burden × interest burden × operating margin × asset turnover × equity multiplier.
 * taxBurden = NI/pretax; interestBurden = pretax/EBIT; operatingMargin = EBIT/sales.
 */
export function dupont5(args: {
  netIncome: number | null; pretaxIncome: number | null; ebit: number | null;
  revenue: number | null; assetTurnover: number | null; equityMultiplier: number | null;
}): DuPontResult {
  const taxBurden = div(args.netIncome, args.pretaxIncome);
  const interestBurden = div(args.pretaxIncome, args.ebit);
  const operatingMargin = div(args.ebit, args.revenue);
  const factors = { taxBurden, interestBurden, operatingMargin, assetTurnover: args.assetTurnover, equityMultiplier: args.equityMultiplier };
  const vals = Object.values(factors);
  const roe = vals.some((v) => v == null) ? null : vals.reduce((a, b) => (a as number) * (b as number), 1) as number;
  // Implied net margin for driver attribution: taxBurden × interestBurden × operatingMargin.
  const netMarginImplied = taxBurden == null || interestBurden == null || operatingMargin == null ? null : taxBurden * interestBurden * operatingMargin;
  return {
    metric: "ROE_DUPONT", steps: 5, roe, factors,
    driver: classifyDriver(netMarginImplied, args.assetTurnover, args.equityMultiplier),
    explanation: "ROE = tax burden × interest burden × operating margin × asset turnover × equity multiplier.",
  };
}
