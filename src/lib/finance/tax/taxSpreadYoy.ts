// src/lib/finance/tax/taxSpreadYoy.ts

import type { TaxSpread } from "./taxSpreadTypes";

export type YoyMetric = {
  year: number;
  value: number | null;
  delta: number | null;   // vs prior year
  deltaPct: number | null; // vs prior year, 0.12 = 12%
};

function pct(delta: number, prior: number): number | null {
  if (!Number.isFinite(delta) || !Number.isFinite(prior)) return null;
  if (prior === 0) return null;
  return delta / prior;
}

export function buildYoySeries(
  spreadsByYear: Record<number, TaxSpread>,
  field: keyof Pick<TaxSpread, "revenue" | "ebitda" | "net_income" | "cfads_proxy" | "officer_comp">
): YoyMetric[] {
  const years = Object.keys(spreadsByYear)
    .map((y) => Number(y))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);

  const series: YoyMetric[] = [];
  let prev: { year: number; value: number | null } | null = null;

  for (const year of years) {
    const v = spreadsByYear[year]?.[field] ?? null;

    let delta: number | null = null;
    let deltaPct: number | null = null;

    if (prev && v !== null && prev.value !== null) {
      delta = v - prev.value;
      deltaPct = pct(delta, prev.value);
    }

    series.push({ year, value: v, delta, deltaPct });
    prev = { year, value: v };
  }

  return series;
}