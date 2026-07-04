/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 6: Industry Intelligence Engine.
 *
 * Per-sector covenant emphasis + reporting-frequency guidance. This is advisory
 * input the covenant recommendation engine (PR 16) consumes; it does not itself
 * set covenants. Pure data, versioned.
 */

import { INDUSTRY_SECTORS, type IndustrySector } from "@/lib/finengine/industry/industryRegistry";

export type ReportingFrequency = "monthly" | "quarterly" | "semiannual" | "annual";

export type IndustryCovenantGuidance = {
  sector: IndustrySector;
  /** Covenant emphases this sector typically warrants (covenant type keys). */
  recommendedCovenants: string[];
  /** Baseline financial-reporting cadence for the sector. */
  reportingFrequency: ReportingFrequency;
  version: number;
};

export const INDUSTRY_COVENANT_GUIDANCE: Record<IndustrySector, IndustryCovenantGuidance> = {
  HEALTHCARE_SERVICES: { sector: "HEALTHCARE_SERVICES", recommendedCovenants: ["DSCR", "AR_AGING", "LEVERAGE"], reportingFrequency: "quarterly", version: 1 },
  CONSTRUCTION: { sector: "CONSTRUCTION", recommendedCovenants: ["DSCR", "WORKING_CAPITAL", "BACKLOG_REPORTING", "WIP_REPORTING", "TANGIBLE_NET_WORTH"], reportingFrequency: "monthly", version: 1 },
  MANUFACTURING: { sector: "MANUFACTURING", recommendedCovenants: ["DSCR", "LEVERAGE", "FCCR", "CAPEX_LIMITATION"], reportingFrequency: "quarterly", version: 1 },
  RESTAURANTS: { sector: "RESTAURANTS", recommendedCovenants: ["DSCR", "FCCR", "DISTRIBUTION_LIMITATION"], reportingFrequency: "quarterly", version: 1 },
  HOTELS: { sector: "HOTELS", recommendedCovenants: ["DSCR", "DEBT_YIELD", "FF&E_RESERVE", "LEVERAGE"], reportingFrequency: "monthly", version: 1 },
  SAAS_SOFTWARE: { sector: "SAAS_SOFTWARE", recommendedCovenants: ["MIN_LIQUIDITY", "MIN_RECURRING_REVENUE", "CASH_BURN_LIMIT"], reportingFrequency: "monthly", version: 1 },
  PROFESSIONAL_SERVICES: { sector: "PROFESSIONAL_SERVICES", recommendedCovenants: ["DSCR", "LEVERAGE", "DISTRIBUTION_LIMITATION"], reportingFrequency: "quarterly", version: 1 },
  AUTO_DEALERS: { sector: "AUTO_DEALERS", recommendedCovenants: ["FLOORPLAN_CURTAILMENT", "INVENTORY_AGING", "NET_WORTH", "DSCR"], reportingFrequency: "monthly", version: 1 },
  REAL_ESTATE_RENTAL: { sector: "REAL_ESTATE_RENTAL", recommendedCovenants: ["DSCR", "LTV", "DEBT_YIELD", "OCCUPANCY_REPORTING"], reportingFrequency: "quarterly", version: 1 },
  RETAIL: { sector: "RETAIL", recommendedCovenants: ["DSCR", "BORROWING_BASE", "INVENTORY_AGING", "FCCR"], reportingFrequency: "monthly", version: 1 },
  TRANSPORTATION: { sector: "TRANSPORTATION", recommendedCovenants: ["DSCR", "FCCR", "LEVERAGE", "EQUIPMENT_MAINTENANCE"], reportingFrequency: "quarterly", version: 1 },
  AGRICULTURE: { sector: "AGRICULTURE", recommendedCovenants: ["WORKING_CAPITAL", "CURRENT_RATIO", "LTV", "CROP_INSURANCE"], reportingFrequency: "annual", version: 1 },
};

export function covenantGuidanceFor(sector: IndustrySector): IndustryCovenantGuidance {
  return INDUSTRY_COVENANT_GUIDANCE[sector];
}

export function allSectorsHaveCovenantGuidance(): boolean {
  return INDUSTRY_SECTORS.every((s) => INDUSTRY_COVENANT_GUIDANCE[s].recommendedCovenants.length > 0);
}
