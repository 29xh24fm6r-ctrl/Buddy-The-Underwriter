/**
 * Source Policy — institutional-grade source taxonomy for the BIE.
 *
 * Defines:
 * 1. Source type taxonomy (what kind of source is it?)
 * 2. Source weight by type (how much does it count toward quality?)
 * 3. Per-section minimum requirements (what is required for committee-grade?)
 *
 * This module is used by the completion gate to compute whether a research
 * mission meets the bar for committee-grade output.
 */

export type SourceType =
  | "court_record"               // Federal/state court filings, PACER, case search
  | "regulatory_filing"          // SEC, OSHA, EPA, state regulators, licensing boards
  | "government_data"            // Census, BLS, BEA, SBA, local government
  | "company_primary"            // Company website, official press releases, SEC filings
  // SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 2 — broadened taxonomy
  | "borrower_official_website"  // The borrower's OWN website (domain-matched to subject)
  | "business_registry"          // OpenCorporates, D&B, state/county business search
  | "secretary_of_state"         // SoS corporate filings (sunbiz, bizfileonline, sos.*)
  | "local_business_record"      // City/county/regional business records & directories
  | "chamber_or_business_award"  // Chamber of commerce, "best of" / local award listings
  | "public_adverse_record_search" // Dedicated adverse-record / sanctions / lien searches
  | "trade_publication"          // Recognized industry trade press (not blogs)
  | "news_primary"               // Major news outlets (WSJ, Bloomberg, local biz journals)
  | "news_secondary"             // General news aggregators, minor outlets
  | "market_research"            // IBISWorld, Statista, recognized market research firms
  | "review_platform"            // Google, Yelp, BBB — anecdotal, low weight
  | "people_search"              // LinkedIn, people finders — low weight, high hallucination risk
  | "ai_synthesis"               // Derived by the model, no external source
  | "unknown_public_web"         // Generic public web page, not otherwise classifiable
  | "unknown";                   // Legacy alias for unknown_public_web (kept for back-compat)

// Weight 0.0 = no evidentiary value, 1.0 = maximum institutional credibility
export const SOURCE_WEIGHTS: Record<SourceType, number> = {
  court_record:                 1.0,
  regulatory_filing:            1.0,
  secretary_of_state:           0.95,
  government_data:              0.9,
  business_registry:            0.9,
  public_adverse_record_search: 0.9,
  borrower_official_website:    0.85,
  company_primary:              0.8,
  trade_publication:            0.75,
  news_primary:                 0.70,
  market_research:              0.70,
  local_business_record:        0.55,
  chamber_or_business_award:    0.50,
  news_secondary:               0.45,
  review_platform:              0.30,
  people_search:                0.20,
  ai_synthesis:                 0.10,
  unknown_public_web:           0.15,
  unknown:                      0.15,
};

/**
 * Institutional / primary source types — used by the completion gate to count
 * "primary/institutional" sources and to grade contradiction strength. A
 * borrower's own website is primary for borrower-profile purposes but is NOT a
 * third-party institutional source, so it is intentionally excluded here.
 */
export const PRIMARY_INSTITUTIONAL_SOURCE_TYPES: SourceType[] = [
  "court_record",
  "regulatory_filing",
  "secretary_of_state",
  "government_data",
  "business_registry",
  "public_adverse_record_search",
  "company_primary",
  "trade_publication",
  "news_primary",
  "market_research",
];

// Per-section minimum source requirements for committee-grade designation
// If minimum is not met, section degrades to 'preliminary' for that section
export type SectionSourceRequirement = {
  section: string;
  minimum_sources: number;
  required_source_types: SourceType[];  // At least one source of these types required
  preferred_source_types: SourceType[]; // Preferred but not required
  note: string;
};

export const SECTION_SOURCE_REQUIREMENTS: SectionSourceRequirement[] = [
  {
    section: "Management Intelligence",
    minimum_sources: 1,
    required_source_types: ["court_record", "regulatory_filing", "company_primary", "news_primary"],
    preferred_source_types: ["court_record", "regulatory_filing"],
    note: "Management profiles must be grounded in public records or credible press, not people-search tools.",
  },
  {
    section: "Litigation and Risk",
    minimum_sources: 1,
    required_source_types: ["court_record", "regulatory_filing", "news_primary"],
    preferred_source_types: ["court_record", "regulatory_filing"],
    note: "Litigation section requires authoritative source — court record, regulatory filing, or credible news.",
  },
  {
    section: "Industry Overview",
    minimum_sources: 2,
    required_source_types: ["trade_publication", "market_research", "news_primary", "government_data"],
    preferred_source_types: ["market_research", "trade_publication"],
    note: "Industry analysis requires at least two institutional sources.",
  },
  {
    section: "Market Intelligence",
    minimum_sources: 2,
    required_source_types: ["government_data", "news_primary", "market_research"],
    preferred_source_types: ["government_data"],
    note: "Local market data must reference government or recognized market sources.",
  },
  {
    section: "Competitive Landscape",
    minimum_sources: 2,
    required_source_types: ["company_primary", "news_primary", "trade_publication", "review_platform"],
    preferred_source_types: ["company_primary", "news_primary"],
    note: "At least 2 named competitors must be identified with verifiable source.",
  },
  {
    section: "Borrower Profile",
    minimum_sources: 1,
    required_source_types: ["company_primary", "news_primary", "review_platform", "regulatory_filing"],
    preferred_source_types: ["company_primary", "news_primary"],
    note: "Borrower profile requires at least one verifiable public-facing source.",
  },
];

/** Extract a normalized hostname (lowercase, no `www.`, no protocol/port). */
export function normalizeDomain(urlOrDomain: string | null | undefined): string | null {
  if (!urlOrDomain) return null;
  let s = urlOrDomain.trim().toLowerCase();
  if (s.length === 0) return null;
  // Strip protocol
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // Strip path/query/fragment
  s = s.split(/[/?#]/)[0];
  // Strip port + leading www.
  s = s.split(":")[0].replace(/^www\./, "");
  return s.length > 0 ? s : null;
}

/** True when `url`'s host matches the borrower's domain (suffix-aware). */
function domainMatchesBorrower(url: string, borrowerDomain: string | null): boolean {
  if (!borrowerDomain) return false;
  const host = normalizeDomain(url);
  if (!host) return false;
  return host === borrowerDomain || host.endsWith(`.${borrowerDomain}`);
}

export type ClassifyOpts = {
  /** The borrower's own website domain (raw or normalized) — enables borrower_official_website. */
  borrowerDomain?: string | null;
};

/**
 * Classify a source URL into a SourceType based on domain patterns.
 * This is a heuristic — not perfect, but captures the most common patterns.
 *
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 2: recognizes the
 * borrower's own website, business registries / secretary-of-state filings,
 * local business records, and chamber/award listings — so a private borrower's
 * legitimate footprint is no longer dumped into "unknown".
 */
export function classifySourceUrl(url: string, opts?: ClassifyOpts): SourceType {
  if (!url) return "unknown_public_web";
  const lower = url.toLowerCase();

  // Borrower's OWN website (highest-priority match — domain-anchored, not pattern)
  if (domainMatchesBorrower(url, normalizeDomain(opts?.borrowerDomain))) {
    return "borrower_official_website";
  }

  // Court records
  if (lower.includes("pacer.") || lower.includes("courtlistener") ||
      lower.includes("justia.com") || lower.includes(".courts.gov") ||
      lower.includes("unicourt") || lower.includes("ck.gov")) return "court_record";

  // Adverse / sanctions / lien record searches
  if (lower.includes("sam.gov") || lower.includes("treasury.gov/ofac") ||
      lower.includes("ofac") || lower.includes("sanctions") ||
      lower.includes("judgmentsearch") || lower.includes("lien-search") ||
      lower.includes("ucc-search") || lower.includes("oig.hhs.gov")) return "public_adverse_record_search";

  // Secretary of state / corporate registry filings
  if (lower.includes("sunbiz.org") || lower.includes("bizfileonline") ||
      lower.includes("sos.state") || lower.includes(".sos.") ||
      lower.includes("/sos/") || lower.includes("sec.state.") ||
      lower.includes("corporations.") || lower.includes("/corp/") ||
      lower.includes("secretary-of-state") || lower.includes("secretaryofstate")) return "secretary_of_state";

  // Business registries / company-record aggregators
  if (lower.includes("opencorporates") || lower.includes("dnb.com") ||
      lower.includes("bizapedia") || lower.includes("dandb.com") ||
      lower.includes("/business-search") || lower.includes("businesssearch") ||
      lower.includes("corporationwiki") || lower.includes("buzzfile")) return "business_registry";

  // Regulatory
  if (lower.includes("sec.gov") || lower.includes("osha.gov") ||
      lower.includes("epa.gov") || lower.includes("ftc.gov") ||
      lower.includes("fdic.gov") || lower.includes("cfpb.gov") ||
      lower.includes(".state.") || lower.includes("bbb.org")) return "regulatory_filing";

  // Government data
  if (lower.includes("census.gov") || lower.includes("bls.gov") ||
      lower.includes("bea.gov") || lower.includes("sba.gov") ||
      lower.includes("data.gov") || lower.includes(".gov/")) return "government_data";

  // Market research
  if (lower.includes("ibisworld") || lower.includes("statista") ||
      lower.includes("mordorintelligence") || lower.includes("grandviewresearch")) return "market_research";

  // Primary news (incl. local business journals)
  if (lower.includes("wsj.com") || lower.includes("bloomberg") ||
      lower.includes("reuters.com") || lower.includes("bizjournals") ||
      lower.includes("businessjournal") || lower.includes("apnews.com") ||
      lower.includes("ft.com")) return "news_primary";

  // Chamber of commerce / local business awards
  if (lower.includes("chamberofcommerce") || lower.includes("chamber.") ||
      lower.includes("/chamber") || lower.includes("best-of-") ||
      lower.includes("bestof") || lower.includes("business-award") ||
      lower.includes("/awards")) return "chamber_or_business_award";

  // Local government / county / city records (regional .us or city/county .gov)
  if (lower.includes(".us/") || lower.includes("county") ||
      lower.includes("cityof") || lower.includes("clerk.")) return "local_business_record";

  // Review platforms
  if (lower.includes("yelp.com") || lower.includes("google.com/maps") ||
      lower.includes("tripadvisor") || lower.includes("glassdoor")) return "review_platform";

  // People search
  if (lower.includes("linkedin.com") || lower.includes("spokeo") ||
      lower.includes("whitepages") || lower.includes("intelius") ||
      lower.includes("beenverified") || lower.includes("peoplefinders")) return "people_search";

  // Trade publications — catch broad patterns
  if (lower.includes("trade") || lower.includes("industry") ||
      lower.includes("association") || lower.includes("magazine")) return "trade_publication";

  return "unknown_public_web";
}

/**
 * Compute the weighted source quality score for a set of URLs.
 * Returns 0.0–1.0.
 */
export function computeSourceQualityScore(sourceUrls: string[], opts?: ClassifyOpts): number {
  if (sourceUrls.length === 0) return 0;
  const weights = sourceUrls.map((url) => SOURCE_WEIGHTS[classifySourceUrl(url, opts)]);
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  // Bonus for diversity of source types
  const types = new Set(sourceUrls.map((url) => classifySourceUrl(url, opts)));
  const diversityBonus = Math.min(0.1, (types.size - 1) * 0.02);
  return Math.min(1.0, avg + diversityBonus);
}
