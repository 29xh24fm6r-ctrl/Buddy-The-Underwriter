/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 6: Industry Intelligence Engine.
 *
 * Per-sector downside stress assumptions used when running a sector-aware
 * sensitivity. Every parameter is explicit and versioned — no unexplained magic
 * numbers. These are DEFAULT downside scenarios; a caller may override.
 *
 * Pure data.
 */

import { INDUSTRY_SECTORS, type IndustrySector } from "@/lib/finengine/industry/industryRegistry";

export type IndustryStressAssumptions = {
  sector: IndustrySector;
  /** Modeled revenue decline in a downside scenario (fraction, 0–1). */
  revenueDeclinePct: number;
  /** Additional margin compression in the downside (basis points). */
  marginCompressionBps: number;
  /** CRE-relevant: incremental vacancy in the downside (fraction). Null if n/a. */
  vacancyStressPct: number | null;
  /** CRE-relevant: cap-rate expansion shock (basis points). Null if n/a. */
  capRateShockBps: number | null;
  version: number;
};

// Downside severity scales with sector cyclicality (see industryRegistry).
export const INDUSTRY_STRESS_ASSUMPTIONS: Record<IndustrySector, IndustryStressAssumptions> = {
  HEALTHCARE_SERVICES: { sector: "HEALTHCARE_SERVICES", revenueDeclinePct: 0.08, marginCompressionBps: 150, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  CONSTRUCTION: { sector: "CONSTRUCTION", revenueDeclinePct: 0.3, marginCompressionBps: 400, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  MANUFACTURING: { sector: "MANUFACTURING", revenueDeclinePct: 0.2, marginCompressionBps: 300, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  RESTAURANTS: { sector: "RESTAURANTS", revenueDeclinePct: 0.25, marginCompressionBps: 350, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  HOTELS: { sector: "HOTELS", revenueDeclinePct: 0.35, marginCompressionBps: 500, vacancyStressPct: 0.2, capRateShockBps: 150, version: 1 },
  SAAS_SOFTWARE: { sector: "SAAS_SOFTWARE", revenueDeclinePct: 0.15, marginCompressionBps: 200, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  PROFESSIONAL_SERVICES: { sector: "PROFESSIONAL_SERVICES", revenueDeclinePct: 0.15, marginCompressionBps: 250, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  AUTO_DEALERS: { sector: "AUTO_DEALERS", revenueDeclinePct: 0.25, marginCompressionBps: 200, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  REAL_ESTATE_RENTAL: { sector: "REAL_ESTATE_RENTAL", revenueDeclinePct: 0.1, marginCompressionBps: 150, vacancyStressPct: 0.1, capRateShockBps: 100, version: 1 },
  RETAIL: { sector: "RETAIL", revenueDeclinePct: 0.2, marginCompressionBps: 350, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  TRANSPORTATION: { sector: "TRANSPORTATION", revenueDeclinePct: 0.25, marginCompressionBps: 300, vacancyStressPct: null, capRateShockBps: null, version: 1 },
  AGRICULTURE: { sector: "AGRICULTURE", revenueDeclinePct: 0.3, marginCompressionBps: 400, vacancyStressPct: null, capRateShockBps: null, version: 1 },
};

export function stressAssumptionsFor(sector: IndustrySector): IndustryStressAssumptions {
  return INDUSTRY_STRESS_ASSUMPTIONS[sector];
}

export function allSectorsHaveStress(): boolean {
  return INDUSTRY_SECTORS.every((s) => !!INDUSTRY_STRESS_ASSUMPTIONS[s]);
}
