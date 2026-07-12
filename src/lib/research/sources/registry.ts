/**
 * Source Registry - Allowlist of Trusted Data Sources
 *
 * All sources must be registered here before they can be fetched.
 * This provides:
 * - Security: Only known, trusted sources are allowed
 * - Governance: Central control over data providers
 * - Rate limiting: Per-source rate limit configuration
 * - Parsing: Source-specific parsing strategies
 *
 * Unknown domains are blocked at runtime and logged to the ledger.
 */

import type { SourceClass } from "../types";

// ============================================================================
// Registry Types
// ============================================================================

export type FetchKind = "json" | "html" | "xml" | "csv" | "pdf";

export type SourceRegistryEntry = {
  /** Unique identifier for this source */
  id: string;
  /** Human-readable name */
  name: string;
  /** Source classification */
  source_class: SourceClass;
  /** Base URL (domain) */
  base_url: string;
  /** Allowed URL paths (regex patterns) */
  allowed_paths: RegExp[];
  /** Expected response format */
  fetch_kind: FetchKind;
  /** Trust score 0-1 (higher = more trusted) */
  trust_score: number;
  /** Rate limit: requests per minute */
  rate_limit_rpm: number;
  /** Request timeout in milliseconds */
  timeout_ms: number;
  /** Maximum response size in bytes */
  max_response_bytes: number;
  /** Whether the source supports ETag/If-Modified-Since */
  supports_caching: boolean;
  /** Required headers for requests */
  required_headers?: Record<string, string>;
  /** Source-specific parsing strategy */
  parsing_strategy?: string;
  /** Description of what this source provides */
  description: string;
};

export type RegistryLookupResult = {
  allowed: boolean;
  entry?: SourceRegistryEntry;
  reason?: string;
};

// ============================================================================
// Source Registry Entries
// ============================================================================

const REGISTRY_ENTRIES: SourceRegistryEntry[] = [
  // ===== Government Sources =====
  {
    id: "census-api",
    name: "U.S. Census Bureau API",
    source_class: "government",
    base_url: "api.census.gov",
    allowed_paths: [/^\/data\/.*/, /^\/data\/\d+\/acs\/.*/, /^\/data\/timeseries\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 60,
    timeout_ms: 30000,
    max_response_bytes: 10 * 1024 * 1024,
    supports_caching: true,
    description: "County Business Patterns, Economic Census, ACS demographics, Business Formation",
  },
  {
    id: "bls-api",
    name: "Bureau of Labor Statistics API",
    source_class: "government",
    base_url: "api.bls.gov",
    allowed_paths: [/^\/publicAPI\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 25,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Employment statistics, wages, productivity data",
  },
  {
    id: "fred-api",
    name: "Federal Reserve Economic Data",
    source_class: "government",
    base_url: "api.stlouisfed.org",
    allowed_paths: [/^\/fred\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 60,
    timeout_ms: 20000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Interest rates, GDP, unemployment, economic indicators",
  },
  {
    id: "sba-data",
    name: "SBA Data Portal",
    source_class: "government",
    base_url: "data.sba.gov",
    allowed_paths: [/^\/dataset\/.*/],
    fetch_kind: "json",
    trust_score: 0.9,
    rate_limit_rpm: 30,
    timeout_ms: 30000,
    max_response_bytes: 10 * 1024 * 1024,
    supports_caching: true,
    description: "SBA size standards, loan program data",
  },
  {
    id: "sba-website",
    name: "SBA Website",
    source_class: "government",
    base_url: "www.sba.gov",
    allowed_paths: [/^\/funding-programs\/.*/, /^\/business-guide\/.*/, /^\/document\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "SBA loan programs, eligibility requirements",
  },
  {
    id: "usda-rd",
    name: "USDA Rural Development",
    source_class: "government",
    base_url: "www.rd.usda.gov",
    allowed_paths: [/^\/programs-services\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "USDA Business & Industry loan programs",
  },
  {
    id: "usda-eligibility",
    name: "USDA Eligibility Service",
    source_class: "government",
    base_url: "eligibility.sc.egov.usda.gov",
    allowed_paths: [/^\/eligibility\/.*/],
    fetch_kind: "html",
    trust_score: 0.85,
    rate_limit_rpm: 15,
    timeout_ms: 30000,
    max_response_bytes: 1 * 1024 * 1024,
    supports_caching: false,
    description: "Rural eligibility verification",
  },
  {
    id: "cdfi-fund",
    name: "CDFI Fund",
    source_class: "government",
    base_url: "www.cdfifund.gov",
    allowed_paths: [/^\/programs-training\/.*/, /^\/awards\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Community Development Financial Institutions programs",
  },
  {
    id: "treasury-ssbci",
    name: "Treasury SSBCI",
    source_class: "government",
    base_url: "home.treasury.gov",
    allowed_paths: [/^\/policy-issues\/small-business-programs\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "State Small Business Credit Initiative",
  },
  {
    id: "fed-sloos",
    name: "Federal Reserve SLOOS",
    source_class: "government",
    base_url: "www.federalreserve.gov",
    allowed_paths: [/^\/data\/sloos\/.*/],
    fetch_kind: "html",
    trust_score: 0.95,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: true,
    description: "Senior Loan Officer Opinion Survey",
  },
  {
    id: "fed-small-biz",
    name: "Fed Small Business Survey",
    source_class: "government",
    base_url: "www.fedsmallbusiness.org",
    allowed_paths: [/^\/survey.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Small Business Credit Survey data",
  },
  {
    id: "hrsa-health-centers",
    name: "HRSA Health Center Programs",
    source_class: "government",
    base_url: "bphc.hrsa.gov",
    allowed_paths: [/^\/funding\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Health center funding opportunities",
  },

  // ===== Regulatory Sources =====
  {
    id: "sec-edgar",
    name: "SEC EDGAR",
    source_class: "regulatory",
    base_url: "efts.sec.gov",
    allowed_paths: [/^\/LATEST\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 10,
    timeout_ms: 45000,
    max_response_bytes: 50 * 1024 * 1024,
    supports_caching: true,
    description: "SEC company filings, 10-K, 10-Q",
  },
  {
    id: "sec-data",
    name: "SEC Data APIs",
    source_class: "regulatory",
    base_url: "data.sec.gov",
    allowed_paths: [/^\/submissions\/.*/, /^\/api\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 10,
    timeout_ms: 45000,
    max_response_bytes: 10 * 1024 * 1024,
    supports_caching: true,
    required_headers: {
      "User-Agent": "BuddyTheUnderwriter/1.0 (institutional lending research)",
    },
    description: "SEC structured company data",
  },
  {
    id: "ecfr",
    name: "Electronic Code of Federal Regulations",
    source_class: "regulatory",
    base_url: "www.ecfr.gov",
    allowed_paths: [/^\/api\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 30,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Federal regulations by agency",
  },
  {
    id: "regulations-gov",
    name: "Regulations.gov API",
    source_class: "regulatory",
    base_url: "api.regulations.gov",
    allowed_paths: [/^\/v4\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Federal rulemakings and public comments",
  },
  {
    id: "ofac",
    name: "OFAC Sanctions List",
    source_class: "regulatory",
    base_url: "www.treasury.gov",
    allowed_paths: [/^\/ofac\/.*/, /^\/resource-center\/sanctions\/.*/],
    fetch_kind: "xml",
    trust_score: 0.95,
    rate_limit_rpm: 10,
    timeout_ms: 60000,
    max_response_bytes: 50 * 1024 * 1024,
    supports_caching: true,
    description: "OFAC SDN list and sanctions data",
  },
  {
    id: "sam-gov",
    name: "SAM.gov Exclusions",
    source_class: "regulatory",
    base_url: "api.sam.gov",
    allowed_paths: [/^\/entity-information\/.*/, /^\/opportunities\/.*/],
    fetch_kind: "json",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Federal exclusions and debarment",
  },
  {
    id: "courtlistener",
    name: "CourtListener RECAP",
    source_class: "regulatory",
    base_url: "www.courtlistener.com",
    allowed_paths: [/^\/api\/rest\/.*/, /^\/recap\/.*/],
    fetch_kind: "json",
    trust_score: 0.8,
    rate_limit_rpm: 30,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Federal court records and PACER data",
  },

  // ===== Industry Sources =====
  {
    id: "rma-reference",
    name: "RMA Industry Benchmarks",
    source_class: "industry",
    base_url: "www.rmahq.org",
    allowed_paths: [/^\/annual-statement-studies\/.*/],
    fetch_kind: "html",
    trust_score: 0.85,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 1 * 1024 * 1024,
    supports_caching: false,
    description: "Industry financial benchmarks (reference only)",
  },

  // ===== Registry expansion (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1) =====
  // sourceDiscovery.ts references these domains for regulatory-environment and
  // management-background missions, but they were never added to this
  // allowlist — meaning the "unknown domains are blocked at runtime" governance
  // this file's own header comment promises was never actually enforced for
  // them. Added here so wiring ingestSource.ts through the allowlisted,
  // retrying fetchSource() (see ../ingestSource.ts) doesn't silently break
  // currently-working ingestion for these sources.
  {
    id: "fda-download",
    name: "FDA Open Data",
    source_class: "regulatory",
    base_url: "api.fda.gov",
    allowed_paths: [/^\/download\.json$/],
    fetch_kind: "json",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "FDA regulatory/enforcement open data",
  },
  {
    id: "ny-dos-ucc-appext",
    name: "New York UCC Filings",
    source_class: "regulatory",
    base_url: "appext20.dos.ny.gov",
    allowed_paths: [/^\/pls\/ucc_public\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "New York Secretary of State UCC lien filings",
  },
  {
    id: "ny-dos-corp-search",
    name: "New York Corporate Registry",
    source_class: "regulatory",
    base_url: "apps.dos.ny.gov",
    allowed_paths: [/^\/publicInquiry\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "New York Secretary of State corporate entity search",
  },
  {
    id: "epa-aqs",
    name: "EPA Air Quality System API",
    source_class: "regulatory",
    base_url: "aqs.epa.gov",
    allowed_paths: [/^\/data\/api\/.*/],
    fetch_kind: "json",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "EPA air quality monitoring data",
  },
  {
    id: "ca-sos-business-search",
    name: "California Corporate Registry",
    source_class: "regulatory",
    base_url: "businesssearch.sos.ca.gov",
    allowed_paths: [/^\/$/, /^\/CBS\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "California Secretary of State business entity + UCC search",
  },
  {
    id: "fl-dos-ucc",
    name: "Florida UCC Filings",
    source_class: "regulatory",
    base_url: "ccfcorp.dos.state.fl.us",
    allowed_paths: [/^\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Florida Division of Corporations UCC lien filings",
  },
  {
    id: "cms-provider-data",
    name: "CMS Provider Data",
    source_class: "regulatory",
    base_url: "data.cms.gov",
    allowed_paths: [/^\/provider-data\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "CMS (Medicare/Medicaid) provider data",
  },
  {
    id: "dot-datahub",
    name: "DOT Data Hub",
    source_class: "regulatory",
    base_url: "datahub.transportation.gov",
    allowed_paths: [/^\/api\/views.*/],
    fetch_kind: "json",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Department of Transportation open data",
  },
  {
    id: "epa-echo",
    name: "EPA ECHO Facility Data",
    source_class: "regulatory",
    base_url: "echodata.epa.gov",
    allowed_paths: [/^\/echo\/dfr_downloads\/.*/],
    fetch_kind: "csv",
    trust_score: 0.9,
    rate_limit_rpm: 15,
    timeout_ms: 30000,
    max_response_bytes: 10 * 1024 * 1024,
    supports_caching: false,
    description: "EPA Enforcement and Compliance History facility data",
  },
  {
    id: "dol-osha-enforcement",
    name: "DOL OSHA Enforcement Data",
    source_class: "regulatory",
    base_url: "enforcedata.dol.gov",
    allowed_paths: [/^\/api\/v1\/.*/],
    fetch_kind: "json",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Department of Labor OSHA enforcement/establishment data",
  },
  {
    id: "nv-sos-entity-search",
    name: "Nevada Corporate Registry",
    source_class: "regulatory",
    base_url: "esos.nv.gov",
    allowed_paths: [/^\/EntitySearch\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Nevada Secretary of State entity search",
  },
  {
    id: "de-icis-entity-search",
    name: "Delaware Corporate Registry",
    source_class: "regulatory",
    base_url: "icis.corp.delaware.gov",
    allowed_paths: [/^\/Ecorp\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Delaware Division of Corporations entity search",
  },
  {
    id: "tx-cpa-coa",
    name: "Texas Certificate of Account Status",
    source_class: "regulatory",
    base_url: "mycpa.cpa.state.tx.us",
    allowed_paths: [/^\/coa\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Texas Comptroller certificate of account status lookup",
  },
  {
    id: "sam-gov-exclusions",
    name: "SAM.gov Exclusions (root domain)",
    source_class: "regulatory",
    base_url: "sam.gov",
    allowed_paths: [/^\/api\/prod\/.*/],
    fetch_kind: "json",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Federal exclusions and debarment (root sam.gov domain, distinct from api.sam.gov)",
  },
  {
    id: "fl-sunbiz",
    name: "Florida Sunbiz Corporate Registry",
    source_class: "regulatory",
    base_url: "search.sunbiz.org",
    allowed_paths: [/^\/Inquiry\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Florida Division of Corporations (Sunbiz) entity search",
  },
  {
    id: "cfpb-data-research",
    name: "CFPB Data & Research",
    source_class: "regulatory",
    base_url: "www.consumerfinance.gov",
    allowed_paths: [/^\/data-research\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "CFPB regulatory data and research",
  },
  {
    id: "ca-dca-licsearch",
    name: "California DCA License Search",
    source_class: "regulatory",
    base_url: "www.dca.ca.gov",
    allowed_paths: [/^\/webapps\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 1 * 1024 * 1024,
    supports_caching: false,
    description: "California Dept. of Consumer Affairs professional license search",
  },
  {
    id: "ny-dos-licensing",
    name: "New York State Licensing",
    source_class: "regulatory",
    base_url: "www.dos.ny.gov",
    allowed_paths: [/^\/licensing\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 1 * 1024 * 1024,
    supports_caching: false,
    description: "New York State licensing portal",
  },
  {
    id: "federal-register-api",
    name: "Federal Register API",
    source_class: "regulatory",
    base_url: "www.federalregister.gov",
    allowed_paths: [/^\/api\/v1\/.*/, /^\/developers\/.*/],
    fetch_kind: "json",
    trust_score: 0.95,
    rate_limit_rpm: 30,
    timeout_ms: 30000,
    max_response_bytes: 5 * 1024 * 1024,
    supports_caching: true,
    description: "Federal Register rulemakings and notices",
  },
  {
    id: "finra-rules-guidance",
    name: "FINRA Rules & Guidance",
    source_class: "regulatory",
    base_url: "www.finra.org",
    allowed_paths: [/^\/rules-guidance\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 15,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "FINRA (federally-designated SRO) rules and guidance",
  },
  {
    id: "fl-license-search",
    name: "Florida DBPR License Search",
    source_class: "regulatory",
    base_url: "www.myfloridalicense.com",
    allowed_paths: [/^\/wl11\.asp$/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 1 * 1024 * 1024,
    supports_caching: false,
    description: "Florida DBPR professional license search",
  },
  {
    id: "osha-data",
    name: "OSHA Data",
    source_class: "regulatory",
    base_url: "www.osha.gov",
    allowed_paths: [/^\/data\/.*/],
    fetch_kind: "html",
    trust_score: 0.9,
    rate_limit_rpm: 15,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "OSHA enforcement/reference data",
  },
  {
    id: "sec-edgar-browse",
    name: "SEC EDGAR Company Browse",
    source_class: "regulatory",
    base_url: "www.sec.gov",
    allowed_paths: [/^\/cgi-bin\/browse-edgar.*/],
    fetch_kind: "html",
    trust_score: 0.95,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "SEC EDGAR company filings browse UI",
  },
  {
    id: "tx-sos-corp",
    name: "Texas Corporate Registry",
    source_class: "regulatory",
    base_url: "www.sos.state.tx.us",
    allowed_paths: [/^\/corp\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 2 * 1024 * 1024,
    supports_caching: false,
    description: "Texas Secretary of State corporate registry",
  },
  {
    id: "tx-tdlr-license",
    name: "Texas TDLR License Search",
    source_class: "regulatory",
    base_url: "www.tdlr.texas.gov",
    allowed_paths: [/^\/LicenseSearch\/.*/],
    fetch_kind: "html",
    trust_score: 0.8,
    rate_limit_rpm: 10,
    timeout_ms: 30000,
    max_response_bytes: 1 * 1024 * 1024,
    supports_caching: false,
    description: "Texas Dept. of Licensing and Regulation license search",
  },

];

// ============================================================================
// Registry Index
// ============================================================================

const REGISTRY_BY_ID: Map<string, SourceRegistryEntry> = new Map(
  REGISTRY_ENTRIES.map((entry) => [entry.id, entry])
);

const REGISTRY_BY_DOMAIN: Map<string, SourceRegistryEntry> = new Map(
  REGISTRY_ENTRIES.map((entry) => [entry.base_url.toLowerCase(), entry])
);

// ============================================================================
// Registry Functions
// ============================================================================

/**
 * Check if a URL is allowed and get its registry entry.
 */
export function lookupSource(url: string): RegistryLookupResult {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // Look up by domain
    const entry = REGISTRY_BY_DOMAIN.get(domain);

    if (!entry) {
      return {
        allowed: false,
        reason: `Domain not in allowlist: ${domain}`,
      };
    }

    // Check if path is allowed
    const pathAllowed = entry.allowed_paths.some((pattern) => pattern.test(path));

    if (!pathAllowed) {
      return {
        allowed: false,
        entry,
        reason: `Path not allowed for ${domain}: ${path}`,
      };
    }

    return {
      allowed: true,
      entry,
    };
  } catch {
    return {
      allowed: false,
      reason: `Invalid URL: ${url}`,
    };
  }
}

/**
 * Get a registry entry by ID.
 */
export function getRegistryEntry(id: string): SourceRegistryEntry | undefined {
  return REGISTRY_BY_ID.get(id);
}

/**
 * Get all registry entries.
 */
export function getAllRegistryEntries(): SourceRegistryEntry[] {
  return [...REGISTRY_ENTRIES];
}

/**
 * Get registry entries by source class.
 */
export function getEntriesByClass(sourceClass: SourceClass): SourceRegistryEntry[] {
  return REGISTRY_ENTRIES.filter((entry) => entry.source_class === sourceClass);
}

/**
 * Get the trust score for a source URL.
 * Returns 0 if the source is not in the registry.
 */
export function getSourceTrustScore(url: string): number {
  const result = lookupSource(url);
  return result.entry?.trust_score ?? 0;
}

/**
 * Get rate limit configuration for a source URL.
 */
export function getSourceRateLimit(url: string): number {
  const result = lookupSource(url);
  return result.entry?.rate_limit_rpm ?? 10; // Default: 10 rpm
}

/**
 * Get timeout configuration for a source URL.
 */
export function getSourceTimeout(url: string): number {
  const result = lookupSource(url);
  return result.entry?.timeout_ms ?? 30000; // Default: 30s
}

/**
 * Get required headers for a source URL.
 */
export function getSourceHeaders(url: string): Record<string, string> {
  const result = lookupSource(url);
  return result.entry?.required_headers ?? {};
}

/**
 * Check if a source supports HTTP caching (ETag/If-Modified-Since).
 */
export function sourceSupportsCache(url: string): boolean {
  const result = lookupSource(url);
  return result.entry?.supports_caching ?? false;
}

// ============================================================================
// Blocked Source Tracking
// ============================================================================

export type BlockedSourceEvent = {
  url: string;
  domain: string;
  reason: string;
  timestamp: string;
  mission_id?: string;
};

const blockedSourceLog: BlockedSourceEvent[] = [];

/**
 * Log a blocked source attempt.
 * This is for auditing purposes.
 */
export function logBlockedSource(
  url: string,
  reason: string,
  missionId?: string
): BlockedSourceEvent {
  let domain = "unknown";
  try {
    domain = new URL(url).hostname;
  } catch {
    // URL parsing failed
  }

  const event: BlockedSourceEvent = {
    url,
    domain,
    reason,
    timestamp: new Date().toISOString(),
    mission_id: missionId,
  };

  blockedSourceLog.push(event);

  // Keep only last 1000 blocked events in memory
  if (blockedSourceLog.length > 1000) {
    blockedSourceLog.shift();
  }

  return event;
}

/**
 * Get recent blocked source events.
 */
export function getRecentBlockedSources(limit = 100): BlockedSourceEvent[] {
  return blockedSourceLog.slice(-limit);
}

/**
 * Clear blocked source log (for testing).
 */
export function clearBlockedSourceLog(): void {
  blockedSourceLog.length = 0;
}
