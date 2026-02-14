// src/lib/finance/pnl/compute.ts
import "server-only";
import type { PnlMetricValue, NormalizedPnl } from "@/lib/finance/types";
import { PNL_CATALOG } from "./catalog";

function n(x: any): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function pct(num: number | null, den: number | null): number | null {
  if (num === null || den === null) return null;
  if (den === 0) return null;
  return (num / den) * 100;
}

function ratio(num: number | null, den: number | null): number | null {
  if (num === null || den === null) return null;
  if (den === 0) return null;
  return num / den;
}

export function computePnlMetrics(pnl: NormalizedPnl): PnlMetricValue[] {
  const revenue = n(pnl.revenue);
  const cogs = n(pnl.cogs);
  const gross_profit =
    n(pnl.gross_profit) ?? (revenue !== null && cogs !== null ? revenue - cogs : null);

  const opex = n(pnl.operating_expenses);
  const net_income = n(pnl.net_income);

  const da = n(pnl.depreciation_amortization);
  const interest = n(pnl.interest_expense);

  const ebit = gross_profit !== null && opex !== null ? gross_profit - opex : null;
  const ebitda = ebit !== null ? ebit + (da ?? 0) : null;

  const valuesById: Record<string, PnlMetricValue> = {};

  valuesById["gross_margin_pct"] = {
    id: "gross_margin_pct",
    label: "Gross Margin",
    unit: "pct",
    value: pct(gross_profit, revenue),
    formula: "Gross Profit / Revenue",
    components: { gross_profit, revenue },
  };

  valuesById["opex_pct_of_sales"] = {
    id: "opex_pct_of_sales",
    label: "Operating Expenses / Revenue",
    unit: "pct",
    value: pct(opex, revenue),
    formula: "Operating Expenses / Revenue",
    components: { operating_expenses: opex, revenue },
  };

  valuesById["net_margin_pct"] = {
    id: "net_margin_pct",
    label: "Net Margin",
    unit: "pct",
    value: pct(net_income, revenue),
    formula: "Net Income / Revenue",
    components: { net_income, revenue },
  };

  valuesById["ebit"] = {
    id: "ebit",
    label: "EBIT",
    unit: "money",
    value: ebit,
    formula: "Gross Profit - Operating Expenses",
    components: { gross_profit, operating_expenses: opex },
  };

  valuesById["ebitda"] = {
    id: "ebitda",
    label: "EBITDA",
    unit: "money",
    value: ebitda,
    formula: "EBIT + Depreciation & Amortization",
    components: { ebit, depreciation_amortization: da },
  };

  valuesById["ebitda_margin_pct"] = {
    id: "ebitda_margin_pct",
    label: "EBITDA Margin",
    unit: "pct",
    value: pct(ebitda, revenue),
    formula: "EBITDA / Revenue",
    components: { ebitda, revenue },
  };

  valuesById["interest_coverage_ebit"] = {
    id: "interest_coverage_ebit",
    label: "Interest Coverage (EBIT)",
    unit: "ratio",
    value: ratio(ebit, interest),
    formula: "EBIT / Interest Expense",
    components: { ebit, interest_expense: interest },
  };

  // Return in catalog order (so your package is stable)
  return PNL_CATALOG.map((c) => valuesById[c.id]).filter(Boolean);
}
