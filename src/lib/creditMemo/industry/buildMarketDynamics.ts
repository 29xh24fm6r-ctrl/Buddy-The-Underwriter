/**
 * NAICS-Group Market Dynamics Fallback
 *
 * When research lacks specific market dynamics, generates a conservative
 * industry-group narrative. Never returns "Pending" for committee output.
 *
 * Pure function — no DB, no server-only.
 */

type IndustryGroup =
  | "manufacturing" | "wholesale" | "retail" | "professional_services"
  | "healthcare" | "construction" | "real_estate" | "food_service"
  | "transportation" | "other_services" | "agriculture" | "finance_insurance";

const MARKET_DYNAMICS: Record<IndustryGroup, string> = {
  manufacturing:
    "Demand is driven by order backlog, customer inventory cycles, and capital equipment replacement schedules. Key sector pressures include input material costs, skilled labor availability, supply chain stability, and capacity utilization. Working-capital cycles can be extended by raw-material lead times and customer payment terms.",
  wholesale:
    "Demand follows downstream retail and commercial consumption patterns. Key pressures include inventory carrying costs, supplier payment terms, transportation costs, and customer concentration. Margins are typically thin and volume-dependent, making working-capital management critical.",
  retail:
    "Demand is driven by consumer traffic, local demographics, disposable income levels, and seasonal shopping patterns. Key pressures include rent/occupancy costs, labor costs, inventory shrinkage, e-commerce competition, and consumer confidence cycles.",
  professional_services:
    "Demand is driven by client project flow, contract renewals, and enterprise discretionary spending. Key pressures include billable utilization rates, talent retention, project concentration, and client payment timing. Revenue is labor-intensive with limited capital requirements but high key-person dependency.",
  healthcare:
    "Demand is supported by aging demographics, chronic disease prevalence, regulatory mandates, and payer reimbursement cycles. Key pressures include reimbursement rate changes, regulatory compliance costs, staffing shortages, and payer concentration.",
  construction:
    "Demand follows public/private capital investment, housing starts, and infrastructure spending. Key pressures include material costs, labor availability, bonding capacity, project concentration, retainage/AR timing, and weather-related scheduling disruptions.",
  real_estate:
    "Demand is driven by occupancy rates, lease renewal cycles, cap-rate trends, and local market supply/demand balance. Key pressures include interest rate sensitivity, vacancy risk, tenant credit quality, property maintenance costs, and refinance exposure.",
  food_service:
    "Demand is driven by consumer traffic, local competition, and discretionary dining spending. Key pressures include food costs, labor costs and availability, lease occupancy, health/safety compliance, seasonal traffic patterns, and delivery/third-party platform fees.",
  transportation:
    "Demand follows freight volumes, manufacturing output, and consumer goods distribution. Key pressures include fuel costs, driver availability, equipment maintenance/replacement, insurance costs, regulatory compliance, and customer concentration.",
  other_services:
    "Demand is driven by enterprise outsourcing needs, customer support requirements, and operational efficiency demands. Key sector pressures include labor availability, training costs, wage inflation, client concentration, and payment cycle timing from enterprise customers.",
  agriculture:
    "Demand follows commodity cycles, weather patterns, and global trade dynamics. Key pressures include input costs (seed, fertilizer, fuel), weather/climate risk, commodity price volatility, storage/logistics costs, and government program dependency.",
  finance_insurance:
    "Demand follows economic activity, regulatory requirements, and risk-transfer needs. Key pressures include interest rate environment, credit quality cycles, regulatory capital requirements, technology/fintech disruption, and claims/loss experience.",
};

// NAICS 2-digit prefix → industry group
const NAICS_PREFIX_MAP: Record<string, IndustryGroup> = {
  "11": "agriculture",
  "21": "construction", // mining — map to construction as closest
  "23": "construction",
  "31": "manufacturing", "32": "manufacturing", "33": "manufacturing",
  "42": "wholesale",
  "44": "retail", "45": "retail",
  "48": "transportation", "49": "transportation",
  "51": "professional_services", // info → professional services
  "52": "finance_insurance",
  "53": "real_estate",
  "54": "professional_services",
  "55": "finance_insurance", // management of companies
  "56": "other_services",
  "61": "professional_services", // education
  "62": "healthcare",
  "71": "other_services", // arts/entertainment
  "72": "food_service",
  "81": "other_services",
  "92": "other_services", // public admin
};

export function resolveIndustryGroup(naicsCode: string | null): IndustryGroup | null {
  if (!naicsCode) return null;
  const prefix = naicsCode.slice(0, 2);
  return NAICS_PREFIX_MAP[prefix] ?? null;
}

/**
 * Returns market dynamics narrative. Uses research data if available,
 * otherwise falls back to NAICS-group conservative narrative.
 * Never returns "Pending."
 */
export function buildMarketDynamicsNarrative(args: {
  naicsCode: string | null;
  researchMarketDynamics: string | null;
}): string | null {
  // Prefer research-sourced dynamics
  if (args.researchMarketDynamics && args.researchMarketDynamics.trim().length > 10 && !args.researchMarketDynamics.startsWith("Pending")) {
    return args.researchMarketDynamics;
  }

  // NAICS-group fallback
  const group = resolveIndustryGroup(args.naicsCode);
  if (!group) return null;
  return MARKET_DYNAMICS[group];
}
