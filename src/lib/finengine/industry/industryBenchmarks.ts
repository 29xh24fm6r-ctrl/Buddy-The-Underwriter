/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 6: Industry Intelligence Engine.
 *
 * Per-sector expectation BANDS for headline underwriting metrics. These are
 * qualitative reference ranges (not policy pass/fail and not the NAICS numeric
 * percentile registry) — they let an analysis flag "outside typical range for
 * this sector". Every number is an explicit, versioned band with a rationale
 * comment. Bridges to the existing numeric benchmark registry via `benchmarkRatio`.
 *
 * Pure data.
 */

import { INDUSTRY_SECTORS, type IndustrySector } from "@/lib/finengine/industry/industryRegistry";
export { benchmarkRatio, type BenchmarkMetricId } from "@/lib/benchmarks/industryBenchmarks";

export type MetricDirection = "higher" | "lower";

export type MetricBand = {
  /** Typical low end of the sector range. */
  typicalLow: number;
  /** Typical high end of the sector range. */
  typicalHigh: number;
  /** Which end is favorable. */
  favorable: MetricDirection;
};

export type IndustryBenchmark = {
  sector: IndustrySector;
  /** metricId → typical band. metricIds are canonical metric ids. */
  bands: Partial<Record<string, MetricBand>>;
  version: number;
};

// Bands reflect broadly-cited SME commercial-credit norms per sector. GROSS_MARGIN
// and EBITDA_MARGIN are ratios (0–1). Kept intentionally wide (typical, not policy).
export const INDUSTRY_BENCHMARKS: Record<IndustrySector, IndustryBenchmark> = {
  HEALTHCARE_SERVICES: {
    sector: "HEALTHCARE_SERVICES",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.45, typicalHigh: 0.7, favorable: "higher" },
      EBITDA_MARGIN: { typicalLow: 0.1, typicalHigh: 0.2, favorable: "higher" },
      CURRENT_RATIO: { typicalLow: 1.2, typicalHigh: 2.0, favorable: "higher" },
      DSO: { typicalLow: 35, typicalHigh: 65, favorable: "lower" }, // payor lag
    },
    version: 1,
  },
  CONSTRUCTION: {
    sector: "CONSTRUCTION",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.12, typicalHigh: 0.25, favorable: "higher" },
      EBITDA_MARGIN: { typicalLow: 0.05, typicalHigh: 0.12, favorable: "higher" },
      CURRENT_RATIO: { typicalLow: 1.1, typicalHigh: 1.6, favorable: "higher" },
      DSO: { typicalLow: 45, typicalHigh: 90, favorable: "lower" }, // retainage
    },
    version: 1,
  },
  MANUFACTURING: {
    sector: "MANUFACTURING",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.2, typicalHigh: 0.4, favorable: "higher" },
      EBITDA_MARGIN: { typicalLow: 0.08, typicalHigh: 0.18, favorable: "higher" },
      INVENTORY_TURNOVER: { typicalLow: 4, typicalHigh: 8, favorable: "higher" },
      CURRENT_RATIO: { typicalLow: 1.3, typicalHigh: 2.2, favorable: "higher" },
    },
    version: 1,
  },
  RESTAURANTS: {
    sector: "RESTAURANTS",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.6, typicalHigh: 0.72, favorable: "higher" }, // food cost 28–40%
      EBITDA_MARGIN: { typicalLow: 0.08, typicalHigh: 0.16, favorable: "higher" },
      CURRENT_RATIO: { typicalLow: 0.6, typicalHigh: 1.2, favorable: "higher" }, // cash business
    },
    version: 1,
  },
  HOTELS: {
    sector: "HOTELS",
    bands: {
      EBITDA_MARGIN: { typicalLow: 0.25, typicalHigh: 0.4, favorable: "higher" },
      DSCR: { typicalLow: 1.3, typicalHigh: 1.8, favorable: "higher" },
    },
    version: 1,
  },
  SAAS_SOFTWARE: {
    sector: "SAAS_SOFTWARE",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.7, typicalHigh: 0.9, favorable: "higher" },
      EBITDA_MARGIN: { typicalLow: 0.0, typicalHigh: 0.3, favorable: "higher" }, // growth vs profit tradeoff
    },
    version: 1,
  },
  PROFESSIONAL_SERVICES: {
    sector: "PROFESSIONAL_SERVICES",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.35, typicalHigh: 0.6, favorable: "higher" },
      EBITDA_MARGIN: { typicalLow: 0.1, typicalHigh: 0.25, favorable: "higher" },
      DSO: { typicalLow: 40, typicalHigh: 75, favorable: "lower" },
    },
    version: 1,
  },
  AUTO_DEALERS: {
    sector: "AUTO_DEALERS",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.1, typicalHigh: 0.18, favorable: "higher" },
      INVENTORY_TURNOVER: { typicalLow: 6, typicalHigh: 12, favorable: "higher" },
    },
    version: 1,
  },
  REAL_ESTATE_RENTAL: {
    sector: "REAL_ESTATE_RENTAL",
    bands: {
      DSCR: { typicalLow: 1.2, typicalHigh: 1.5, favorable: "higher" },
      NOI_MARGIN: { typicalLow: 0.55, typicalHigh: 0.7, favorable: "higher" },
    },
    version: 1,
  },
  RETAIL: {
    sector: "RETAIL",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.25, typicalHigh: 0.45, favorable: "higher" },
      INVENTORY_TURNOVER: { typicalLow: 3, typicalHigh: 6, favorable: "higher" },
      CURRENT_RATIO: { typicalLow: 1.2, typicalHigh: 2.0, favorable: "higher" },
    },
    version: 1,
  },
  TRANSPORTATION: {
    sector: "TRANSPORTATION",
    bands: {
      GROSS_MARGIN: { typicalLow: 0.15, typicalHigh: 0.35, favorable: "higher" },
      EBITDA_MARGIN: { typicalLow: 0.08, typicalHigh: 0.18, favorable: "higher" },
    },
    version: 1,
  },
  AGRICULTURE: {
    sector: "AGRICULTURE",
    bands: {
      CURRENT_RATIO: { typicalLow: 1.3, typicalHigh: 2.5, favorable: "higher" },
      DEBT_TO_EQUITY: { typicalLow: 0.4, typicalHigh: 1.0, favorable: "lower" },
    },
    version: 1,
  },
};

export function benchmarkBandsFor(sector: IndustrySector): IndustryBenchmark {
  return INDUSTRY_BENCHMARKS[sector];
}

export type BandAssessment = "within" | "above" | "below" | "no_band";

/** Where a value sits vs the sector band (direction-agnostic position). */
export function assessAgainstBand(sector: IndustrySector, metricId: string, value: number | null): BandAssessment {
  const band = INDUSTRY_BENCHMARKS[sector].bands[metricId];
  if (!band || value == null) return "no_band";
  if (value < band.typicalLow) return "below";
  if (value > band.typicalHigh) return "above";
  return "within";
}

export function allSectorsHaveBenchmarks(): boolean {
  return INDUSTRY_SECTORS.every((s) => Object.keys(INDUSTRY_BENCHMARKS[s].bands).length > 0);
}
