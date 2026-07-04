/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 6: Industry Intelligence Engine.
 *
 * Sector taxonomy for underwriting context. Maps the 12 supported sectors to
 * NAICS prefixes and structural characteristics. This is the spine the risk /
 * benchmark / stress / covenant modules key on. Additive: it complements the
 * existing NAICS numeric benchmark registry (`src/lib/benchmarks`) rather than
 * duplicating it — this layer is qualitative + parametric per sector.
 *
 * Pure data. Every parameter is explicit and versioned (INDUSTRY_REGISTRY_VERSION).
 */

export type IndustrySector =
  | "HEALTHCARE_SERVICES"
  | "CONSTRUCTION"
  | "MANUFACTURING"
  | "RESTAURANTS"
  | "HOTELS"
  | "SAAS_SOFTWARE"
  | "PROFESSIONAL_SERVICES"
  | "AUTO_DEALERS"
  | "REAL_ESTATE_RENTAL"
  | "RETAIL"
  | "TRANSPORTATION"
  | "AGRICULTURE";

export const INDUSTRY_SECTORS: readonly IndustrySector[] = [
  "HEALTHCARE_SERVICES",
  "CONSTRUCTION",
  "MANUFACTURING",
  "RESTAURANTS",
  "HOTELS",
  "SAAS_SOFTWARE",
  "PROFESSIONAL_SERVICES",
  "AUTO_DEALERS",
  "REAL_ESTATE_RENTAL",
  "RETAIL",
  "TRANSPORTATION",
  "AGRICULTURE",
] as const;

export type Cyclicality = "defensive" | "moderate" | "cyclical" | "highly_cyclical";
export type CapitalIntensity = "asset_light" | "moderate" | "asset_heavy";

export type IndustryDefinition = {
  sector: IndustrySector;
  label: string;
  /** NAICS 2–4 digit prefixes that map to this sector (longest-match wins). */
  naicsPrefixes: string[];
  cyclicality: Cyclicality;
  capitalIntensity: CapitalIntensity;
  /** Primary collateral class an underwriter looks to for this sector. */
  primaryCollateral: string;
};

export const INDUSTRY_REGISTRY: Record<IndustrySector, IndustryDefinition> = {
  HEALTHCARE_SERVICES: {
    sector: "HEALTHCARE_SERVICES",
    label: "Healthcare Services",
    naicsPrefixes: ["62"],
    cyclicality: "defensive",
    capitalIntensity: "moderate",
    primaryCollateral: "receivables_equipment",
  },
  CONSTRUCTION: {
    sector: "CONSTRUCTION",
    label: "Construction",
    naicsPrefixes: ["23"],
    cyclicality: "highly_cyclical",
    capitalIntensity: "moderate",
    primaryCollateral: "receivables_equipment",
  },
  MANUFACTURING: {
    sector: "MANUFACTURING",
    label: "Manufacturing",
    naicsPrefixes: ["31", "32", "33"],
    cyclicality: "cyclical",
    capitalIntensity: "asset_heavy",
    primaryCollateral: "inventory_equipment_re",
  },
  RESTAURANTS: {
    sector: "RESTAURANTS",
    label: "Restaurants & Food Service",
    naicsPrefixes: ["722"],
    cyclicality: "cyclical",
    capitalIntensity: "moderate",
    primaryCollateral: "equipment_leasehold",
  },
  HOTELS: {
    sector: "HOTELS",
    label: "Hotels & Lodging",
    naicsPrefixes: ["721"],
    cyclicality: "highly_cyclical",
    capitalIntensity: "asset_heavy",
    primaryCollateral: "real_estate",
  },
  SAAS_SOFTWARE: {
    sector: "SAAS_SOFTWARE",
    label: "SaaS / Software",
    naicsPrefixes: ["5112", "5182", "5415"],
    cyclicality: "moderate",
    capitalIntensity: "asset_light",
    primaryCollateral: "recurring_revenue_ip",
  },
  PROFESSIONAL_SERVICES: {
    sector: "PROFESSIONAL_SERVICES",
    label: "Professional Services",
    naicsPrefixes: ["54"],
    cyclicality: "moderate",
    capitalIntensity: "asset_light",
    primaryCollateral: "receivables",
  },
  AUTO_DEALERS: {
    sector: "AUTO_DEALERS",
    label: "Auto Dealers",
    naicsPrefixes: ["441"],
    cyclicality: "cyclical",
    capitalIntensity: "moderate",
    primaryCollateral: "floorplan_inventory",
  },
  REAL_ESTATE_RENTAL: {
    sector: "REAL_ESTATE_RENTAL",
    label: "Real Estate Rental & Leasing",
    naicsPrefixes: ["531"],
    cyclicality: "moderate",
    capitalIntensity: "asset_heavy",
    primaryCollateral: "real_estate",
  },
  RETAIL: {
    sector: "RETAIL",
    label: "Retail Trade",
    naicsPrefixes: ["44", "45"],
    cyclicality: "cyclical",
    capitalIntensity: "moderate",
    primaryCollateral: "inventory",
  },
  TRANSPORTATION: {
    sector: "TRANSPORTATION",
    label: "Transportation & Warehousing",
    naicsPrefixes: ["48", "49"],
    cyclicality: "cyclical",
    capitalIntensity: "asset_heavy",
    primaryCollateral: "equipment_rolling_stock",
  },
  AGRICULTURE: {
    sector: "AGRICULTURE",
    label: "Agriculture",
    naicsPrefixes: ["11"],
    cyclicality: "highly_cyclical",
    capitalIntensity: "asset_heavy",
    primaryCollateral: "land_equipment_crops",
  },
};

export const INDUSTRY_REGISTRY_VERSION = 1;

/** Resolve a sector from a NAICS code by longest-prefix match. Null if unknown. */
export function resolveSectorFromNaics(naics: string | null | undefined): IndustrySector | null {
  if (!naics) return null;
  const code = naics.replace(/\D/g, "");
  if (!code) return null;
  let best: { sector: IndustrySector; len: number } | null = null;
  for (const def of Object.values(INDUSTRY_REGISTRY)) {
    for (const prefix of def.naicsPrefixes) {
      if (code.startsWith(prefix) && (!best || prefix.length > best.len)) {
        best = { sector: def.sector, len: prefix.length };
      }
    }
  }
  return best?.sector ?? null;
}

export function getIndustryDefinition(sector: IndustrySector): IndustryDefinition {
  return INDUSTRY_REGISTRY[sector];
}
