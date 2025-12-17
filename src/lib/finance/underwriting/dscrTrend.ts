// src/lib/finance/underwriting/dscrTrend.ts

import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import { computeDscr } from "./dscr";

export type DscrSeriesItem = {
  year: number | null;
  cfads: number | null;
  annual_debt_service: number | null;
  dscr: number | null;
};

export type DscrTrendResult = {
  series: DscrSeriesItem[];
  worst: { year: number; dscr: number | null; cfads: number | null } | null;
  flags: string[];
};

export function computeDscrTrend(
  spreadsByYear: Record<number, TaxSpread>,
  annualDebtService: number | null,
  getAnnualDebtServiceForYear?: (year: number) => number | null
): DscrTrendResult {
  const years = Object.keys(spreadsByYear).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const series: DscrSeriesItem[] = [];
  const allFlags: string[] = [];

  let worst: { year: number; dscr: number | null; cfads: number | null } | null = null;

  for (const year of years) {
    const spread = spreadsByYear[year];
    const adsForYear = getAnnualDebtServiceForYear ? getAnnualDebtServiceForYear(year) : annualDebtService;
    const result = computeDscr(spread, { annual_debt_service: adsForYear });

    const cfads = spread.cfads_proxy ?? spread.ebitda;
    const dscr = result.dscr;

    series.push({
      year,
      cfads,
      annual_debt_service: adsForYear,
      dscr,
    });

    if (result.flags) {
      allFlags.push(...result.flags);
    }

    // Find worst DSCR
    if (dscr !== null) {
      if (worst === null || dscr < worst.dscr!) {
        worst = { year, dscr, cfads };
      }
    }
  }

  const flags = [...new Set(allFlags)];

  return { series, worst, flags };
}