/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 6: Industry Intelligence Engine.
 *
 * Per-sector qualitative risk profiles. Pure data, versioned. Consumed by the
 * credit-officer brain (PR 15) and examiner engine (PR 12) to make concerns
 * industry-aware.
 */

import { INDUSTRY_SECTORS, type IndustrySector } from "@/lib/finengine/industry/industryRegistry";

export type Volatility = "low" | "moderate" | "high";

export type IndustryRiskProfile = {
  sector: IndustrySector;
  revenueVolatility: Volatility;
  marginPressure: Volatility;
  seasonality: Volatility;
  /** Headline risks an underwriter should always address for this sector. */
  keyRisks: string[];
  version: number;
};

export const INDUSTRY_RISK_PROFILES: Record<IndustrySector, IndustryRiskProfile> = {
  HEALTHCARE_SERVICES: {
    sector: "HEALTHCARE_SERVICES",
    revenueVolatility: "low",
    marginPressure: "high",
    seasonality: "low",
    keyRisks: ["reimbursement_rate_cuts", "payor_concentration", "regulatory_compliance", "labor_cost_inflation"],
    version: 1,
  },
  CONSTRUCTION: {
    sector: "CONSTRUCTION",
    revenueVolatility: "high",
    marginPressure: "high",
    seasonality: "high",
    keyRisks: ["backlog_volatility", "fixed_price_cost_overruns", "retainage_timing", "surety_bonding_capacity", "wip_accounting_quality"],
    version: 1,
  },
  MANUFACTURING: {
    sector: "MANUFACTURING",
    revenueVolatility: "moderate",
    marginPressure: "moderate",
    seasonality: "moderate",
    keyRisks: ["input_cost_inflation", "customer_concentration", "inventory_obsolescence", "capex_cycle", "supply_chain"],
    version: 1,
  },
  RESTAURANTS: {
    sector: "RESTAURANTS",
    revenueVolatility: "high",
    marginPressure: "high",
    seasonality: "moderate",
    keyRisks: ["thin_margins", "food_labor_cost_inflation", "location_dependence", "discretionary_spend_sensitivity", "high_failure_rate"],
    version: 1,
  },
  HOTELS: {
    sector: "HOTELS",
    revenueVolatility: "high",
    marginPressure: "moderate",
    seasonality: "high",
    keyRisks: ["revpar_cyclicality", "high_operating_leverage", "capex_pip_requirements", "brand_flag_dependence", "travel_demand_shocks"],
    version: 1,
  },
  SAAS_SOFTWARE: {
    sector: "SAAS_SOFTWARE",
    revenueVolatility: "moderate",
    marginPressure: "low",
    seasonality: "low",
    keyRisks: ["churn_retention", "cac_payback", "deferred_revenue_liability", "customer_concentration", "cash_burn_runway"],
    version: 1,
  },
  PROFESSIONAL_SERVICES: {
    sector: "PROFESSIONAL_SERVICES",
    revenueVolatility: "moderate",
    marginPressure: "moderate",
    seasonality: "low",
    keyRisks: ["key_person_dependence", "utilization_rates", "receivable_realization", "client_concentration"],
    version: 1,
  },
  AUTO_DEALERS: {
    sector: "AUTO_DEALERS",
    revenueVolatility: "high",
    marginPressure: "high",
    seasonality: "moderate",
    keyRisks: ["floorplan_curtailment", "inventory_aging", "interest_rate_sensitivity", "oem_dependence", "thin_new_vehicle_margins"],
    version: 1,
  },
  REAL_ESTATE_RENTAL: {
    sector: "REAL_ESTATE_RENTAL",
    revenueVolatility: "low",
    marginPressure: "low",
    seasonality: "low",
    keyRisks: ["vacancy_rollover", "tenant_concentration", "cap_rate_expansion", "refinance_risk", "deferred_maintenance"],
    version: 1,
  },
  RETAIL: {
    sector: "RETAIL",
    revenueVolatility: "high",
    marginPressure: "high",
    seasonality: "high",
    keyRisks: ["ecommerce_disruption", "inventory_markdown_risk", "discretionary_spend_sensitivity", "lease_obligations"],
    version: 1,
  },
  TRANSPORTATION: {
    sector: "TRANSPORTATION",
    revenueVolatility: "high",
    marginPressure: "high",
    seasonality: "moderate",
    keyRisks: ["fuel_cost_volatility", "freight_rate_cyclicality", "driver_shortage", "equipment_capex", "customer_concentration"],
    version: 1,
  },
  AGRICULTURE: {
    sector: "AGRICULTURE",
    revenueVolatility: "high",
    marginPressure: "high",
    seasonality: "high",
    keyRisks: ["commodity_price_volatility", "weather_yield_risk", "input_cost_inflation", "land_value_dependence", "government_program_reliance"],
    version: 1,
  },
};

export function riskProfileFor(sector: IndustrySector): IndustryRiskProfile {
  return INDUSTRY_RISK_PROFILES[sector];
}

/** Guard: every sector has a risk profile (used by the industry coverage test). */
export function allSectorsHaveRiskProfiles(): boolean {
  return INDUSTRY_SECTORS.every((s) => !!INDUSTRY_RISK_PROFILES[s]);
}
