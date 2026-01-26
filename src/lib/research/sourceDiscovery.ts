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

// ============================================================================
// State FIPS Codes (for Census API queries)
// ============================================================================

const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06",
  CO: "08", CT: "09", DE: "10", DC: "11", FL: "12",
  GA: "13", HI: "15", ID: "16", IL: "17", IN: "18",
  IA: "19", KS: "20", KY: "21", LA: "22", ME: "23",
  MD: "24", MA: "25", MI: "26", MN: "27", MS: "28",
  MO: "29", MT: "30", NE: "31", NV: "32", NH: "33",
  NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44",
  SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55",
  WY: "56", PR: "72",
};

/**
 * Extract state code from geography string (e.g., "TX", "Texas", "Houston, TX")
 */
function extractStateCode(geography: string): string | null {
  // Already a 2-letter code
  const upper = geography.toUpperCase().trim();
  if (STATE_FIPS[upper]) return upper;

  // Check for state abbreviation at end (e.g., "Houston, TX")
  const match = geography.match(/,?\s*([A-Z]{2})$/i);
  if (match && STATE_FIPS[match[1].toUpperCase()]) {
    return match[1].toUpperCase();
  }

  // Common state name mappings
  const stateNames: Record<string, string> = {
    ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
    COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
    HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
    KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
    MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
    MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA",
    "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN",
    TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA",
    "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
  };

  if (stateNames[upper]) return stateNames[upper];

  return null;
}

/**
 * Discover sources for a market_demand mission.
 * Sources: Census ACS (population, income), BEA regional economic data
 */
function discoverMarketDemandSources(subject: MissionSubject): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const geography = subject.geography ?? "US";
  const stateCode = extractStateCode(geography);
  const stateFips = stateCode ? STATE_FIPS[stateCode] : null;

  // 1. Census ACS 5-Year Estimates - Population and Income
  // API: https://api.census.gov/data/2022/acs/acs5
  // Variables: B01003_001E (total population), B19013_001E (median household income)
  if (stateFips) {
    // State-level demographics
    sources.push({
      source_class: "government",
      source_name: "Census ACS Population & Income (State)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E,B19013_001E,B19301_001E&for=state:${stateFips}`,
      fetch_kind: "json",
      priority: 1,
    });

    // County-level breakdown within state
    sources.push({
      source_class: "government",
      source_name: "Census ACS Population & Income (Counties)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E,B19013_001E,B19301_001E&for=county:*&in=state:${stateFips}`,
      fetch_kind: "json",
      priority: 2,
    });
  } else {
    // National-level demographics
    sources.push({
      source_class: "government",
      source_name: "Census ACS Population & Income (US)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E,B19013_001E,B19301_001E&for=us:*`,
      fetch_kind: "json",
      priority: 1,
    });

    // State-level breakdown
    sources.push({
      source_class: "government",
      source_name: "Census ACS Population & Income (All States)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E,B19013_001E,B19301_001E&for=state:*`,
      fetch_kind: "json",
      priority: 2,
    });
  }

  // 2. Census ACS - Age Distribution (for demographic trends)
  // B01001_001E: Total, B01001_020E-B01001_025E: Age groups
  if (stateFips) {
    sources.push({
      source_class: "government",
      source_name: "Census ACS Age Distribution",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B01001_001E,B01002_001E&for=state:${stateFips}`,
      fetch_kind: "json",
      priority: 3,
    });
  }

  // 3. Census Population Estimates (for year-over-year growth)
  // API: https://api.census.gov/data/2023/pep/population
  if (stateFips) {
    sources.push({
      source_class: "government",
      source_name: "Census Population Estimates",
      url: `https://api.census.gov/data/2023/pep/population?get=NAME,POP_2023,POP_2022,NPOPCHG_2023&for=state:${stateFips}`,
      fetch_kind: "json",
      priority: 4,
    });
  } else {
    sources.push({
      source_class: "government",
      source_name: "Census Population Estimates (All States)",
      url: `https://api.census.gov/data/2023/pep/population?get=NAME,POP_2023,POP_2022,NPOPCHG_2023&for=state:*`,
      fetch_kind: "json",
      priority: 4,
    });
  }

  // 4. BEA Regional Economic Data
  // Note: BEA API requires key but is free, we use public summary data
  // For MVP, we use Census GDP data instead which is keyless
  sources.push({
    source_class: "government",
    source_name: "Census Economic Indicators",
    url: `https://api.census.gov/data/timeseries/eits/resconst?get=cell_value,data_type_code,time_slot_id,category_code&time=from+2020&seasonally_adj=yes`,
    fetch_kind: "json",
    priority: 5,
  });

  // 5. If we have NAICS, get industry-specific employment trends in the area
  if (subject.naics_code && stateFips) {
    const naics2 = subject.naics_code.slice(0, 2);
    sources.push({
      source_class: "government",
      source_name: "Census CBP Industry Employment (State)",
      url: `https://api.census.gov/data/2021/cbp?get=NAICS2017,NAICS2017_LABEL,ESTAB,EMP,PAYANN&for=state:${stateFips}&NAICS2017=${naics2}*`,
      fetch_kind: "json",
      priority: 6,
    });
  }

  return sources;
}

// ============================================================================
// Regulated Industries by NAICS (for determining licensing requirements)
// ============================================================================

type RegulatedIndustryInfo = {
  naics_prefix: string;
  industry_name: string;
  regulatory_bodies: string[];
  requires_state_licensing: boolean;
  osha_relevant: boolean;
  epa_relevant: boolean;
};

const REGULATED_INDUSTRIES: RegulatedIndustryInfo[] = [
  // Healthcare
  { naics_prefix: "621", industry_name: "Ambulatory Health Care", regulatory_bodies: ["CMS", "State Health Dept"], requires_state_licensing: true, osha_relevant: true, epa_relevant: false },
  { naics_prefix: "622", industry_name: "Hospitals", regulatory_bodies: ["CMS", "Joint Commission", "State Health Dept"], requires_state_licensing: true, osha_relevant: true, epa_relevant: true },
  { naics_prefix: "623", industry_name: "Nursing and Residential Care", regulatory_bodies: ["CMS", "State Health Dept"], requires_state_licensing: true, osha_relevant: true, epa_relevant: false },

  // Construction
  { naics_prefix: "236", industry_name: "Construction of Buildings", regulatory_bodies: ["OSHA", "State Contractor Board"], requires_state_licensing: true, osha_relevant: true, epa_relevant: true },
  { naics_prefix: "237", industry_name: "Heavy and Civil Engineering", regulatory_bodies: ["OSHA", "DOT", "State Contractor Board"], requires_state_licensing: true, osha_relevant: true, epa_relevant: true },
  { naics_prefix: "238", industry_name: "Specialty Trade Contractors", regulatory_bodies: ["OSHA", "State Contractor Board"], requires_state_licensing: true, osha_relevant: true, epa_relevant: true },

  // Food Services
  { naics_prefix: "722", industry_name: "Food Services and Drinking Places", regulatory_bodies: ["FDA", "State Health Dept", "Local Health"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },
  { naics_prefix: "311", industry_name: "Food Manufacturing", regulatory_bodies: ["FDA", "USDA", "State Ag Dept"], requires_state_licensing: true, osha_relevant: true, epa_relevant: true },

  // Transportation
  { naics_prefix: "484", industry_name: "Truck Transportation", regulatory_bodies: ["DOT", "FMCSA"], requires_state_licensing: true, osha_relevant: true, epa_relevant: true },
  { naics_prefix: "485", industry_name: "Transit and Ground Passenger", regulatory_bodies: ["DOT", "State PUC"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },

  // Finance
  { naics_prefix: "522", industry_name: "Credit Intermediation", regulatory_bodies: ["OCC", "FDIC", "State Banking"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },
  { naics_prefix: "523", industry_name: "Securities and Investments", regulatory_bodies: ["SEC", "FINRA", "State Securities"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },
  { naics_prefix: "524", industry_name: "Insurance", regulatory_bodies: ["State Insurance Dept"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },

  // Environmental
  { naics_prefix: "562", industry_name: "Waste Management", regulatory_bodies: ["EPA", "State Env Agency"], requires_state_licensing: true, osha_relevant: true, epa_relevant: true },

  // Manufacturing
  { naics_prefix: "324", industry_name: "Petroleum and Coal Products", regulatory_bodies: ["EPA", "OSHA", "DOE"], requires_state_licensing: false, osha_relevant: true, epa_relevant: true },
  { naics_prefix: "325", industry_name: "Chemical Manufacturing", regulatory_bodies: ["EPA", "OSHA"], requires_state_licensing: false, osha_relevant: true, epa_relevant: true },

  // Childcare
  { naics_prefix: "624", industry_name: "Social Assistance (Childcare)", regulatory_bodies: ["State Licensing", "HHS"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },

  // Real Estate
  { naics_prefix: "531", industry_name: "Real Estate", regulatory_bodies: ["State Real Estate Commission"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },

  // Professional Services
  { naics_prefix: "5411", industry_name: "Legal Services", regulatory_bodies: ["State Bar"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },
  { naics_prefix: "5412", industry_name: "Accounting Services", regulatory_bodies: ["State Board of Accountancy"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },

  // Auto
  { naics_prefix: "441", industry_name: "Motor Vehicle Dealers", regulatory_bodies: ["State DMV", "FTC"], requires_state_licensing: true, osha_relevant: false, epa_relevant: false },
  { naics_prefix: "8111", industry_name: "Automotive Repair", regulatory_bodies: ["State BAR", "EPA"], requires_state_licensing: true, osha_relevant: false, epa_relevant: true },
];

/**
 * Get regulated industry info for a NAICS code
 */
function getRegulatedIndustryInfo(naicsCode: string): RegulatedIndustryInfo | null {
  // Try increasingly shorter prefixes
  for (let len = naicsCode.length; len >= 2; len--) {
    const prefix = naicsCode.slice(0, len);
    const match = REGULATED_INDUSTRIES.find(r => r.naics_prefix === prefix);
    if (match) return match;
  }
  return null;
}

/**
 * Discover sources for a regulatory_environment mission.
 * Sources: Federal Register, SBA SOP, state licensing, OSHA/EPA
 */
function discoverRegulatoryEnvironmentSources(subject: MissionSubject): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const naicsCode = subject.naics_code;
  const geography = subject.geography ?? "US";
  const stateCode = extractStateCode(geography);

  // Get regulatory info for this industry
  const regulatedInfo = naicsCode ? getRegulatedIndustryInfo(naicsCode) : null;

  // 1. Federal Register API - Recent rules and notices
  // API: https://www.federalregister.gov/developers/documentation/api/v1
  // Search by agency and date
  const naics2 = naicsCode?.slice(0, 2);

  // Map NAICS to relevant agencies for Federal Register search
  const agencyMapping: Record<string, string[]> = {
    "23": ["osha", "epa"], // Construction
    "31": ["fda", "usda", "osha", "epa"], // Food manufacturing
    "32": ["epa", "osha"], // Manufacturing
    "33": ["osha", "epa"], // Manufacturing
    "44": ["ftc", "cpsc"], // Retail
    "45": ["ftc", "cpsc"], // Retail
    "48": ["dot", "fmcsa"], // Transportation
    "52": ["sec", "cfpb", "occ", "fdic"], // Finance
    "53": ["cfpb", "hud"], // Real Estate
    "54": ["ftc"], // Professional services
    "56": ["osha", "epa"], // Waste management
    "62": ["cms", "hhs", "osha"], // Healthcare
    "72": ["fda", "osha"], // Food services
    "81": ["epa", "ftc"], // Other services
  };

  const agencies = naics2 && agencyMapping[naics2] ? agencyMapping[naics2] : ["sba"];

  // Federal Register - recent documents from relevant agencies
  for (const agency of agencies.slice(0, 2)) { // Limit to 2 agencies
    sources.push({
      source_class: "regulatory",
      source_name: `Federal Register - ${agency.toUpperCase()}`,
      url: `https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=${agency}&conditions[publication_date][gte]=2023-01-01&per_page=20&order=newest`,
      fetch_kind: "json",
      priority: sources.length + 1,
    });
  }

  // 2. SBA SOP Reference (Size Standards and Lending)
  // Note: SBA SOP is PDF-based, but we can link to public reference pages
  sources.push({
    source_class: "regulatory",
    source_name: "SBA Size Standards",
    url: `https://www.sba.gov/document/support-table-size-standards`,
    fetch_kind: "html",
    priority: sources.length + 1,
  });

  // SBA NAICS-specific size standards API
  if (naicsCode) {
    sources.push({
      source_class: "regulatory",
      source_name: "SBA NAICS Size Standards",
      url: `https://data.sba.gov/dataset/size-standards/resource/d0e2c5ff-4f46-4972-b99b-f3e6a77e5c58`,
      fetch_kind: "json",
      priority: sources.length + 1,
    });
  }

  // 3. OSHA Data (if relevant industry)
  if (regulatedInfo?.osha_relevant || !regulatedInfo) {
    // OSHA Establishment Search (inspection data)
    sources.push({
      source_class: "regulatory",
      source_name: "OSHA Enforcement Data",
      url: `https://enforcedata.dol.gov/api/v1/osha/establishment`,
      fetch_kind: "json",
      priority: sources.length + 1,
    });

    // OSHA Industry Profiles
    if (naicsCode) {
      sources.push({
        source_class: "regulatory",
        source_name: "OSHA Industry Data",
        url: `https://www.osha.gov/data/sic-manual`,
        fetch_kind: "html",
        priority: sources.length + 1,
      });
    }
  }

  // 4. EPA Data (if environmental regulations relevant)
  if (regulatedInfo?.epa_relevant || !regulatedInfo) {
    // EPA ECHO (Enforcement and Compliance History)
    sources.push({
      source_class: "regulatory",
      source_name: "EPA Enforcement & Compliance",
      url: `https://echodata.epa.gov/echo/dfr_downloads/facilities.csv?output=JSON`,
      fetch_kind: "json",
      priority: sources.length + 1,
    });

    // EPA Air Emissions (for manufacturing/industrial)
    if (naics2 && ["31", "32", "33", "23", "48", "56"].includes(naics2)) {
      sources.push({
        source_class: "regulatory",
        source_name: "EPA Air Quality Data",
        url: `https://aqs.epa.gov/data/api/list/states?email=test@test.com&key=test`,
        fetch_kind: "json",
        priority: sources.length + 1,
      });
    }
  }

  // 5. State-specific licensing (if applicable)
  if (stateCode && regulatedInfo?.requires_state_licensing) {
    // State business/professional licensing portals
    // Note: These vary by state, we provide a reference URL pattern
    const stateLicensingUrls: Record<string, string> = {
      CA: "https://www.dca.ca.gov/webapps/licsearch.php",
      TX: "https://www.tdlr.texas.gov/LicenseSearch/",
      FL: "https://www.myfloridalicense.com/wl11.asp",
      NY: "https://www.dos.ny.gov/licensing/",
      // Add more states as needed
    };

    if (stateLicensingUrls[stateCode]) {
      sources.push({
        source_class: "regulatory",
        source_name: `${stateCode} State Licensing`,
        url: stateLicensingUrls[stateCode],
        fetch_kind: "html",
        priority: sources.length + 1,
      });
    }
  }

  // 6. Industry-specific regulations
  if (regulatedInfo) {
    // Add sources based on regulatory bodies
    for (const body of regulatedInfo.regulatory_bodies.slice(0, 2)) {
      const bodyUrls: Record<string, string> = {
        CMS: "https://data.cms.gov/provider-data/",
        FDA: "https://api.fda.gov/download.json",
        DOT: "https://datahub.transportation.gov/api/views",
        SEC: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany",
        FINRA: "https://www.finra.org/rules-guidance",
        CFPB: "https://www.consumerfinance.gov/data-research/",
      };

      if (bodyUrls[body]) {
        sources.push({
          source_class: "regulatory",
          source_name: `${body} Regulatory Data`,
          url: bodyUrls[body],
          fetch_kind: "json",
          priority: sources.length + 1,
        });
      }
    }
  }

  return sources;
}

/**
 * Discover sources for a management_backgrounds mission.
 * Sources: SEC filings, state corporate registries, public records
 */
function discoverManagementBackgroundsSources(subject: MissionSubject): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const companyName = subject.company_name;
  const geography = subject.geography ?? "US";
  const stateCode = extractStateCode(geography);

  // 1. SEC EDGAR - Officer/Director searches
  // CIK lookup for company
  if (companyName) {
    sources.push({
      source_class: "regulatory",
      source_name: "SEC EDGAR Company Search",
      url: `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(companyName)}&dateRange=custom&startdt=2020-01-01&forms=10-K,10-Q,DEF%2014A`,
      fetch_kind: "json",
      priority: 1,
    });

    // SEC Full-Text search for company mentions
    sources.push({
      source_class: "regulatory",
      source_name: "SEC EDGAR Full-Text",
      url: `https://efts.sec.gov/LATEST/search-index?q="${encodeURIComponent(companyName)}"&forms=10-K,8-K,DEF%2014A`,
      fetch_kind: "json",
      priority: 2,
    });
  }

  // 2. State Corporate Registry
  // Note: These APIs vary significantly by state
  if (stateCode) {
    const stateCorpRegistries: Record<string, string> = {
      CA: "https://businesssearch.sos.ca.gov/CBS/SearchResults",
      TX: "https://mycpa.cpa.state.tx.us/coa/",
      FL: "https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResultDetail",
      NY: "https://apps.dos.ny.gov/publicInquiry/",
      DE: "https://icis.corp.delaware.gov/Ecorp/EntitySearch/NameSearch.aspx",
      NV: "https://esos.nv.gov/EntitySearch/OnlineEntitySearch",
    };

    if (stateCorpRegistries[stateCode]) {
      sources.push({
        source_class: "regulatory",
        source_name: `${stateCode} Corporate Registry`,
        url: stateCorpRegistries[stateCode],
        fetch_kind: "html",
        priority: 3,
      });
    }
  }

  // 3. Federal Court Records (PACER is paid, but we can reference it)
  // Instead, use free sources like RECAP Archive
  if (companyName) {
    sources.push({
      source_class: "regulatory",
      source_name: "CourtListener RECAP",
      url: `https://www.courtlistener.com/api/rest/v3/dockets/?q=${encodeURIComponent(companyName)}`,
      fetch_kind: "json",
      priority: 4,
    });
  }

  // 4. OFAC Sanctions List (Treasury SDN List)
  // Free API for sanctions screening
  sources.push({
    source_class: "regulatory",
    source_name: "OFAC SDN List",
    url: "https://www.treasury.gov/ofac/downloads/sdn.csv",
    fetch_kind: "html", // CSV format
    priority: 5,
  });

  // 5. SBA Debarment List
  sources.push({
    source_class: "regulatory",
    source_name: "SAM.gov Exclusions",
    url: "https://sam.gov/api/prod/federalorganizations/v1/orgs",
    fetch_kind: "json",
    priority: 6,
  });

  // 6. State Business Entity Filings (UCC, Liens)
  if (stateCode) {
    const stateUccRegistries: Record<string, string> = {
      CA: "https://businesssearch.sos.ca.gov/",
      TX: "https://www.sos.state.tx.us/corp/sosda/index.shtml",
      FL: "https://ccfcorp.dos.state.fl.us/",
      NY: "https://appext20.dos.ny.gov/pls/ucc_public/",
    };

    if (stateUccRegistries[stateCode]) {
      sources.push({
        source_class: "regulatory",
        source_name: `${stateCode} UCC Filings`,
        url: stateUccRegistries[stateCode],
        fetch_kind: "html",
        priority: 7,
      });
    }
  }

  return sources;
}

/**
 * Discover sources for a demographics mission.
 * More detailed demographic analysis focused on consumer/workforce characteristics.
 */
function discoverDemographicsSources(subject: MissionSubject): DiscoveredSource[] {
  const sources: DiscoveredSource[] = [];
  const geography = subject.geography ?? "US";
  const stateCode = extractStateCode(geography);
  const stateFips = stateCode ? STATE_FIPS[stateCode] : null;

  // 1. Census ACS - Detailed Population Characteristics
  // B01001: Sex by Age, B01002: Median Age, B01003: Total Population
  const baseVars = "NAME,B01003_001E,B01002_001E,B19013_001E,B19301_001E,B25077_001E";
  // B25077_001E = Median home value (good proxy for affluence)

  if (stateFips) {
    sources.push({
      source_class: "government",
      source_name: "Census ACS Detailed Demographics (State)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=${baseVars}&for=state:${stateFips}`,
      fetch_kind: "json",
      priority: 1,
    });

    // County-level for more granular analysis
    sources.push({
      source_class: "government",
      source_name: "Census ACS Detailed Demographics (Counties)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=${baseVars}&for=county:*&in=state:${stateFips}`,
      fetch_kind: "json",
      priority: 2,
    });

    // Metro/micro statistical areas
    sources.push({
      source_class: "government",
      source_name: "Census ACS Metro Areas",
      url: `https://api.census.gov/data/2022/acs/acs5?get=${baseVars}&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`,
      fetch_kind: "json",
      priority: 3,
    });
  } else {
    // National overview
    sources.push({
      source_class: "government",
      source_name: "Census ACS Demographics (US)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=${baseVars}&for=us:*`,
      fetch_kind: "json",
      priority: 1,
    });

    sources.push({
      source_class: "government",
      source_name: "Census ACS Demographics (All States)",
      url: `https://api.census.gov/data/2022/acs/acs5?get=${baseVars}&for=state:*`,
      fetch_kind: "json",
      priority: 2,
    });
  }

  // 2. Census ACS - Education and Employment Status
  // B15003: Educational Attainment, B23025: Employment Status
  if (stateFips) {
    sources.push({
      source_class: "government",
      source_name: "Census ACS Education & Employment",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B15003_001E,B15003_022E,B15003_023E,B15003_024E,B15003_025E,B23025_002E,B23025_005E&for=state:${stateFips}`,
      fetch_kind: "json",
      priority: 4,
    });
  }

  // 3. Census ACS - Commuting Patterns (good for retail/service businesses)
  // B08301: Means of Transportation to Work
  if (stateFips) {
    sources.push({
      source_class: "government",
      source_name: "Census ACS Commuting Patterns",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B08301_001E,B08301_003E,B08301_010E,B08301_021E&for=state:${stateFips}`,
      fetch_kind: "json",
      priority: 5,
    });
  }

  // 4. Census ACS - Housing Characteristics
  // B25001: Housing Units, B25002: Occupancy Status, B25024: Units in Structure
  if (stateFips) {
    sources.push({
      source_class: "government",
      source_name: "Census ACS Housing",
      url: `https://api.census.gov/data/2022/acs/acs5?get=NAME,B25001_001E,B25002_002E,B25002_003E,B25077_001E&for=state:${stateFips}`,
      fetch_kind: "json",
      priority: 6,
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
      return discoverMarketDemandSources(subject);

    case "demographics":
      return discoverDemographicsSources(subject);

    case "regulatory_environment":
      return discoverRegulatoryEnvironmentSources(subject);

    case "management_backgrounds":
      return discoverManagementBackgroundsSources(subject);

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
