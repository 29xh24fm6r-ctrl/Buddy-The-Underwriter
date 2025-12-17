// src/lib/finance/underwriting/results.ts

export type UnderwritingResults = {
  policy_min_dscr: number;

  annual_debt_service: number | null;

  worst_year: number | null;
  worst_dscr: number | null;

  // summary DSCRs
  avg_dscr: number | null;           // simple average across years with DSCR
  weighted_dscr: number | null;      // weighted by revenue (or CFADS)
  stressed_dscr: number | null;      // simple stress (CFADS - 10%) / ADS

  // trend direction hints
  cfads_trend: "up" | "down" | "flat" | "unknown";
  revenue_trend: "up" | "down" | "flat" | "unknown";

  // top flags & data quality
  flags: string[];
  low_confidence_years: number[];

  // per-year rollup (for table rendering)
  by_year: Array<{
    year: number;
    revenue: number | null;
    cfads: number | null;
    officer_comp: number | null;
    ebitda: number | null;
    dscr: number | null;
    confidence: number;
  }>;
};