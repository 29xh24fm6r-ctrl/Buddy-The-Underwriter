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
  | "court_record"           // Federal/state court filings, PACER, case search
  | "regulatory_filing"      // SEC, OSHA, EPA, state regulators, licensing boards
  | "government_data"        // Census, BLS, BEA, SBA, local government
  | "company_primary"        // Company website, official press releases, SEC filings
  | "trade_publication"      // Recognized industry trade press (not blogs)
  | "news_primary"           // Major news outlets (WSJ, Bloomberg, local biz journals)
  | "news_secondary"         // General news aggregators, minor outlets
  | "market_research"        // IBISWorld, Statista, recognized market research firms
  | "review_platform"        // Google, Yelp, BBB — anecdotal, low weight
  | "people_search"          // LinkedIn, people finders — low weight, high hallucination risk
  | "ai_synthesis"           // Derived by the model, no external source
  | "unknown";               // Could not classify

// Weight 0.0 = no evidentiary value, 1.0 = maximum institutional credibility
export const SOURCE_WEIGHTS: Record<SourceType, number> = {
  court_record:       1.0,
  regulatory_filing:  1.0,
  government_data:    0.9,
  company_primary:    0.8,
  trade_publication:  0.75,
  news_primary:       0.70,
  market_research:    0.70,
  news_secondary:     0.45,
  review_platform:    0.30,
  people_search:      0.20,
  ai_synthesis:       0.10,
  unknown:            0.15,
};

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

/**
 * Classify a source URL into a SourceType based on domain patterns.
 * This is a heuristic — not perfect, but captures the most common patterns.
 */
export function classifySourceUrl(url: string): SourceType {
  if (!url) return "unknown";
  const lower = url.toLowerCase();

  // Court records
  if (lower.includes("pacer.") || lower.includes("courtlistener") ||
      lower.includes("justia.com") || lower.includes(".courts.gov") ||
      lower.includes("unicourt") || lower.includes("ck.gov")) return "court_record";

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

  // Primary news
  if (lower.includes("wsj.com") || lower.includes("bloomberg") ||
      lower.includes("reuters.com") || lower.includes("bizjournals") ||
      lower.includes("apnews.com") || lower.includes("ft.com")) return "news_primary";

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

  return "unknown";
}

/**
 * Compute the weighted source quality score for a set of URLs.
 * Returns 0.0–1.0.
 */
export function computeSourceQualityScore(sourceUrls: string[]): number {
  if (sourceUrls.length === 0) return 0;
  const weights = sourceUrls.map((url) => SOURCE_WEIGHTS[classifySourceUrl(url)]);
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  // Bonus for diversity of source types
  const types = new Set(sourceUrls.map(classifySourceUrl));
  const diversityBonus = Math.min(0.1, (types.size - 1) * 0.02);
  return Math.min(1.0, avg + diversityBonus);
}
