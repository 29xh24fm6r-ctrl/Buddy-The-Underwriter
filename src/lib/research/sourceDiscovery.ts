/**
 * Source Discovery Engine
 *
 * Discovers data sources for a research mission.
 * NO paywalled sources. NO scraping sites that block bots.
 * Only stable, public APIs.
 */

import type { DiscoveredSource, MissionSubject, MissionType } from "./types";

/**
 * NAICS to SIC code mapping (approximate, for SEC EDGAR searches)
 * SEC still uses SIC codes, so we need to map NAICS → SIC for company searches.
 */
const NAICS_TO_SIC: Record<string, string[]> = {
  // Construction
  "236": ["1500", "1520", "1540"], // Building construction
  "237": ["1600", "1620", "1629"], // Heavy/civil engineering
  "238": ["1700", "1711", "1731", "1741", "1751", "1761", "1771"], // Specialty trades

  // Manufacturing
  "311": ["2000", "2010", "2020", "2030", "2040", "2050"], // Food manufacturing
  "312": ["2080", "2082", "2085"], // Beverage manufacturing
  "332": ["3400", "3410", "3420", "3430", "3440"], // Fabricated metal
  "333": ["3500", "3510", "3520", "3530", "3540"], // Machinery

  // Retail
  "441": ["5500", "5510", "5520", "5530"], // Motor vehicle dealers
  "442": ["5700", "5710", "5712", "5713"], // Furniture stores
  "445": ["5400", "5410", "5411", "5412"], // Food & beverage stores
  "448": ["5600", "5610", "5620", "5630"], // Clothing stores

  // Real Estate
  "531": ["6500", "6510", "6512", "6531"], // Real estate
  "532": ["7350", "7359"], // Rental & leasing

  // Professional Services
  "541": ["8700", "8711", "8721", "8731", "8732", "8733", "8734"], // Professional services

  // Healthcare
  "621": ["8000", "8010", "8011", "8020", "8021"], // Ambulatory healthcare
  "622": ["8060", "8062", "8063"], // Hospitals
  "623": ["8050", "8051", "8052"], // Nursing/residential care

  // Accommodation & Food
  "721": ["7000", "7010", "7011"], // Accommodation
  "722": ["5800", "5810", "5812"], // Food services
};

/**
 * Get SIC codes for a NAICS code (for SEC EDGAR searches)
 */
function getSicCodesForNaics(naicsCode: string): string[] {
  // Try exact match first (6-digit)
  if (NAICS_TO_SIC[naicsCode]) return NAICS_TO_SIC[naicsCode];

  // Try 3-digit prefix
  const prefix3 = naicsCode.slice(0, 3);
  if (NAICS_TO_SIC[prefix3]) return NAICS_TO_SIC[prefix3];

  // Try 2-digit prefix
  const prefix2 = naicsCode.slice(0, 2);
  if (NAICS_TO_SIC[prefix2]) return NAICS_TO_SIC[prefix2];

  return [];
}

/**
 * Discover sources for an industry_landscape mission.
 */
function discoverIndustryLandscapeSources(subject: MissionSubject): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const naicsCode = subject.naics_code;
  const geography = subject.geography ?? "US";

  if (!naicsCode) {
    // Can't do much without NAICS
    return sources;
  }

  // 1. Census County Business Patterns (CBP) - Industry stats by NAICS
  // API: https://api.census.gov/data/2021/cbp
  // Returns: establishment counts, employment, payroll by NAICS
  const naics2 = naicsCode.slice(0, 2);
  sources.push({
    source_class: "government",
    source_name: "Census County Business Patterns",
    url: `https://api.census.gov/data/2021/cbp?get=NAICS2017,NAICS2017_LABEL,ESTAB,EMP,PAYANN&for=us:*&NAICS2017=${naics2}*`,
    fetch_kind: "json",
    priority: 1,
  });

  // 2. BLS Quarterly Census of Employment and Wages (QCEW)
  // API: https://data.bls.gov/cew/data/api/
  // Provides industry-level employment data
  // Note: BLS QCEW API requires specific series IDs, so we use the broader stats endpoint
  sources.push({
    source_class: "government",
    source_name: "BLS Employment Statistics",
    url: `https://api.bls.gov/publicAPI/v2/timeseries/data/CEU${naics2}000001?startyear=2019&endyear=2024`,
    fetch_kind: "json",
    priority: 2,
  });

  // 3. SEC EDGAR - Company Search by SIC code
  // This gives us public companies in the industry for competitive analysis
  const sicCodes = getSicCodesForNaics(naicsCode);
  if (sicCodes.length > 0) {
    // Use the first SIC code for the search
    const sicCode = sicCodes[0];
    sources.push({
      source_class: "regulatory",
      source_name: "SEC EDGAR Company Search",
      url: `https://efts.sec.gov/LATEST/search-index?q=*&dateRange=custom&startdt=2023-01-01&enddt=2024-12-31&forms=10-K&sic=${sicCode}`,
      fetch_kind: "json",
      priority: 3,
    });

    // Also try the EDGAR full-text search for recent 10-Ks
    sources.push({
      source_class: "regulatory",
      source_name: "SEC EDGAR 10-K Filings",
      url: `https://efts.sec.gov/LATEST/search-index?q=*&forms=10-K&sic=${sicCode}&dateRange=custom&startdt=2023-01-01&enddt=2024-12-31`,
      fetch_kind: "json",
      priority: 4,
    });
  }

  // 4. Census Economic Census (for detailed industry data)
  // This provides more detailed industry metrics
  sources.push({
    source_class: "government",
    source_name: "Census Economic Survey",
    url: `https://api.census.gov/data/2022/ecnbasic?get=NAICS2017,NAICS2017_LABEL,ESTAB,RCPTOT,EMP&for=us:*&NAICS2017=${naics2}*`,
    fetch_kind: "json",
    priority: 5,
  });

  return sources;
}

/**
 * Discover sources for a competitive_analysis mission.
 */
function discoverCompetitiveAnalysisSources(subject: MissionSubject): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const naicsCode = subject.naics_code;

  if (!naicsCode) return sources;

  const sicCodes = getSicCodesForNaics(naicsCode);

  // SEC EDGAR searches for public company filings
  for (const sicCode of sicCodes.slice(0, 2)) {
    sources.push({
      source_class: "regulatory",
      source_name: `SEC EDGAR SIC ${sicCode}`,
      url: `https://efts.sec.gov/LATEST/search-index?q=*&forms=10-K&sic=${sicCode}&dateRange=custom&startdt=2023-01-01&enddt=2024-12-31`,
      fetch_kind: "json",
      priority: sources.length + 1,
    });
  }

  return sources;
}

/**
 * Main discovery function.
 * Returns a deterministic list of sources to fetch for a mission.
 */
export function discoverSources(
  missionType: MissionType,
  subject: MissionSubject
): DiscoveredSource[] {
  switch (missionType) {
    case "industry_landscape":
      return discoverIndustryLandscapeSources(subject);

    case "competitive_analysis":
      return discoverCompetitiveAnalysisSources(subject);

    case "market_demand":
    case "demographics":
    case "regulatory_environment":
    case "management_backgrounds":
      // Phase 2: implement these
      return [];

    default:
      return [];
  }
}

/**
 * Validate that a NAICS code is well-formed.
 */
export function isValidNaicsCode(code: string): boolean {
  // NAICS codes are 2-6 digits
  return /^\d{2,6}$/.test(code);
}

/**
 * Get a human-readable industry name from NAICS code.
 * This is a simplified mapping for common codes.
 */
export function getNaicsIndustryName(code: string): string {
  const names: Record<string, string> = {
    "23": "Construction",
    "236": "Construction of Buildings",
    "237": "Heavy and Civil Engineering Construction",
    "238": "Specialty Trade Contractors",
    "31": "Manufacturing",
    "32": "Manufacturing",
    "33": "Manufacturing",
    "44": "Retail Trade",
    "45": "Retail Trade",
    "52": "Finance and Insurance",
    "53": "Real Estate and Rental and Leasing",
    "54": "Professional, Scientific, and Technical Services",
    "62": "Health Care and Social Assistance",
    "72": "Accommodation and Food Services",
  };

  // Try exact match
  if (names[code]) return names[code];

  // Try 3-digit
  if (names[code.slice(0, 3)]) return names[code.slice(0, 3)];

  // Try 2-digit
  if (names[code.slice(0, 2)]) return names[code.slice(0, 2)];

  return `NAICS ${code}`;
}
