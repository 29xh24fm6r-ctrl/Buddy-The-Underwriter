/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 3
 *
 * Section source status split. The old gate produced a single binary "X/6
 * sections meet source requirements" figure, which is far too coarse for a
 * private borrower: a borrower profile can be preliminary-ready on file evidence
 * while still lacking the public/attested sources committee needs.
 *
 * Each research section now carries TWO independent statuses plus the basis the
 * status rests on:
 *   - preliminary_source_status: is this section good enough for preliminary
 *     underwriting? (file/banker-certified evidence can satisfy this)
 *   - committee_source_status: is this section good enough for committee?
 *     (requires public/attested/institutional sources)
 *   - evidence_basis: WHAT the section currently rests on.
 *
 * Pure module (no server-only, no DB) so it is fully unit-testable.
 */

import type { SourceType } from "./sourcePolicy";

export type SectionStatus = "pass" | "warn" | "fail";

export type EvidenceBasis =
  | "public_web"
  | "borrower_official"
  | "banker_certified"
  | "loan_file"
  | "fallback"
  | "insufficient";

export type SectionSourceStatus = {
  section: string;
  committee_source_status: SectionStatus;
  preliminary_source_status: SectionStatus;
  evidence_basis: EvidenceBasis;
  detail: string;
};

export type SectionSourceContext = {
  /** All source types found across the mission (deduped). */
  sourceTypes: Set<SourceType>;
  /**
   * Source types cited SPECIFICALLY by the borrower/litigation thread (not
   * the whole-mission pool). FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md):
   * litigationAndRisk() previously used the flattened `sourceTypes` above,
   * so ANY thread anywhere citing an authoritative adverse-record-shaped URL
   * (e.g. the Industry thread citing a regulatory news article) made the
   * Litigation and Risk section report committee-grade adverse-record
   * backing even when the Litigation section itself had zero sources.
   * Defaults to `sourceTypes` when not supplied so existing callers/tests
   * that don't care about this distinction keep working unchanged.
   */
  litigationSourceTypes?: Set<SourceType>;
  /** Hard wrong/conflicting-entity disposition — fails ALL section statuses. */
  entityConflict: boolean;
  /** Entity confirmed against a public source at committee confidence. */
  entityConfirmedPublicly: boolean;
  /** A source classified as the borrower's own official website was found. */
  hasBorrowerOfficialSource: boolean;
  /** Borrower website is on file in Memo Inputs (even if not crawled as a source). */
  hasBorrowerWebsiteOnFile: boolean;
  /** Banker-certified borrower story / business description on file. */
  hasBankerStory: boolean;
  hasBusinessDescription: boolean;
  /** A real (non-placeholder) NAICS or an industry description is present. */
  hasIndustry: boolean;
  /** A management profile (public, repaired, or fallback) exists. */
  managementProfileOnFile: boolean;
  managementBasis: "public_web" | "fallback" | null;
  /** Any principal publicly/attested confirmed. */
  managementPubliclyConfirmed: boolean;
  /** The borrower/litigation thread ran (adverse search was attempted). */
  adverseSearchAttempted: boolean;
  /** A known public adverse finding surfaced (kept conservative — default false). */
  adverseFindingPublic: boolean;
  /** Count of named competitors found. */
  namedCompetitors: number;
};

const has = (types: Set<SourceType>, ...wanted: SourceType[]) =>
  wanted.some((t) => types.has(t));

/** Institutional source types relevant per section (committee-grade evidence). */
const COMMITTEE_TYPES: Record<string, SourceType[]> = {
  "Borrower Profile": [
    "borrower_official_website", "company_primary", "news_primary",
    "business_registry", "secretary_of_state", "regulatory_filing",
  ],
  "Management Intelligence": [
    "court_record", "regulatory_filing", "news_primary",
    "public_adverse_record_search", "secretary_of_state",
  ],
  "Litigation and Risk": [
    "court_record", "regulatory_filing", "public_adverse_record_search", "news_primary",
  ],
  "Industry Overview": ["trade_publication", "market_research", "government_data", "news_primary"],
  "Market Intelligence": ["government_data", "market_research", "news_primary"],
  "Competitive Landscape": ["company_primary", "news_primary", "trade_publication"],
};

export const SECTION_ORDER = [
  "Borrower Profile",
  "Management Intelligence",
  "Litigation and Risk",
  "Industry Overview",
  "Market Intelligence",
  "Competitive Landscape",
] as const;

/**
 * Compute the split source status for all research sections.
 * A wrong/conflicting public entity fails every section (we cannot trust any
 * content when we are not sure we researched the right company).
 */
export function evaluateSectionSourceStatuses(
  ctx: SectionSourceContext,
): SectionSourceStatus[] {
  if (ctx.entityConflict) {
    return SECTION_ORDER.map((section) => ({
      section,
      committee_source_status: "fail" as SectionStatus,
      preliminary_source_status: "fail" as SectionStatus,
      evidence_basis: "insufficient" as EvidenceBasis,
      detail: "Wrong/conflicting public entity — section cannot be trusted until identity is resolved.",
    }));
  }

  return [
    borrowerProfile(ctx),
    managementIntelligence(ctx),
    litigationAndRisk(ctx),
    externalSection(ctx, "Industry Overview"),
    externalSection(ctx, "Market Intelligence"),
    competitiveLandscape(ctx),
  ];
}

/** Convenience: how many sections are preliminary-ready / committee-ready. */
export function summarizeSectionStatuses(statuses: SectionSourceStatus[]): {
  preliminaryReady: number;
  committeeReady: number;
  total: number;
  committeeBlockers: string[];
} {
  const preliminaryReady = statuses.filter((s) => s.preliminary_source_status !== "fail").length;
  const committeeReady = statuses.filter((s) => s.committee_source_status === "pass").length;
  const committeeBlockers = statuses
    .filter((s) => s.committee_source_status !== "pass")
    .map((s) => s.section);
  return { preliminaryReady, committeeReady, total: statuses.length, committeeBlockers };
}

// ── per-section evaluators ───────────────────────────────────────────────────

function borrowerProfile(ctx: SectionSourceContext): SectionSourceStatus {
  const officialOrPublic =
    ctx.hasBorrowerOfficialSource ||
    has(ctx.sourceTypes, "borrower_official_website", "company_primary", "news_primary", "business_registry", "secretary_of_state");

  const evidence_basis: EvidenceBasis = ctx.hasBorrowerOfficialSource
    ? "borrower_official"
    : ctx.hasBankerStory
      ? "banker_certified"
      : officialOrPublic
        ? "public_web"
        : "insufficient";

  // Preliminary: entity identified + (official/website or banker story) + description + industry
  const preliminaryReady =
    (ctx.hasBorrowerOfficialSource || ctx.hasBorrowerWebsiteOnFile || ctx.hasBankerStory) &&
    ctx.hasBusinessDescription &&
    ctx.hasIndustry;

  // Committee: borrower official/public source or attested supporting doc, no conflict
  const committeePass = officialOrPublic || (ctx.hasBorrowerWebsiteOnFile && ctx.entityConfirmedPublicly);

  return {
    section: "Borrower Profile",
    preliminary_source_status: preliminaryReady ? "pass" : "warn",
    committee_source_status: committeePass ? "pass" : "warn",
    evidence_basis,
    detail: committeePass
      ? "Borrower profile backed by official/public source."
      : preliminaryReady
        ? "Preliminary-ready on borrower official/file evidence; committee needs a public/attested source."
        : "Insufficient borrower evidence for preliminary underwriting.",
  };
}

function managementIntelligence(ctx: SectionSourceContext): SectionSourceStatus {
  const evidence_basis: EvidenceBasis = ctx.managementBasis === "fallback"
    ? "fallback"
    : ctx.managementPubliclyConfirmed
      ? "public_web"
      : ctx.managementProfileOnFile
        ? "banker_certified"
        : "insufficient";

  // Preliminary: a profile on file + banker-certified identity + no known adverse public finding
  const preliminaryReady =
    ctx.managementProfileOnFile && !ctx.adverseFindingPublic;
  // file-based / fallback is a warn (acceptable for preliminary, flagged)
  const preliminary_source_status: SectionStatus = !preliminaryReady
    ? "fail"
    : ctx.managementPubliclyConfirmed ? "pass" : "warn";

  // Committee: public/attested verification + adverse screen complete + no fabrication
  const committeePass =
    ctx.managementPubliclyConfirmed &&
    has(ctx.sourceTypes, ...COMMITTEE_TYPES["Management Intelligence"]) &&
    ctx.adverseSearchAttempted;

  return {
    section: "Management Intelligence",
    preliminary_source_status,
    committee_source_status: committeePass ? "pass" : ctx.managementProfileOnFile ? "warn" : "fail",
    evidence_basis,
    detail: committeePass
      ? "Management publicly/attested-verified with adverse screen."
      : ctx.managementBasis === "fallback"
        ? "Management profile is banker-certified/file-based; public confirmation limited."
        : ctx.managementProfileOnFile
          ? "Management profile on file; committee needs public/attested verification + adverse screen."
          : "No management profile available.",
  };
}

/**
 * Whether a set of source types includes an authoritative adverse-record
 * source (court record, regulatory filing, adverse-record search, or
 * primary news). Exported so callers building an adverse-screen evidence
 * signal (see evidenceQuality.ts's hasAdverseScreen) use the exact same
 * definition of "authoritative" as the Litigation and Risk section status.
 */
export function hasAuthoritativeAdverseSource(sourceTypes: Set<SourceType>): boolean {
  return has(sourceTypes, ...COMMITTEE_TYPES["Litigation and Risk"]);
}

function litigationAndRisk(ctx: SectionSourceContext): SectionSourceStatus {
  const hasAuthoritative = hasAuthoritativeAdverseSource(ctx.litigationSourceTypes ?? ctx.sourceTypes);
  const evidence_basis: EvidenceBasis = hasAuthoritative
    ? "public_web"
    : ctx.adverseSearchAttempted
      ? "loan_file"
      : "insufficient";

  // Preliminary: an adverse search was attempted, none found, public coverage limited → warn
  const preliminary_source_status: SectionStatus = ctx.adverseFindingPublic
    ? "warn"
    : ctx.adverseSearchAttempted ? "warn" : "fail";

  // Committee: authoritative adverse evidence OR explicit manual review
  const committee_source_status: SectionStatus = hasAuthoritative ? "pass" : "warn";

  return {
    section: "Litigation and Risk",
    preliminary_source_status,
    committee_source_status,
    evidence_basis,
    detail: hasAuthoritative
      ? "Authoritative adverse-record source present."
      : ctx.adverseSearchAttempted
        ? "Adverse search attempted; no public adverse records found (public coverage limited). Committee needs an authoritative adverse search or explicit manual review."
        : "No adverse search evidence yet.",
  };
}

function externalSection(ctx: SectionSourceContext, section: "Industry Overview" | "Market Intelligence"): SectionSourceStatus {
  const hasExternal = has(ctx.sourceTypes, ...COMMITTEE_TYPES[section]);
  const evidence_basis: EvidenceBasis = hasExternal ? "public_web" : ctx.hasIndustry ? "loan_file" : "insufficient";

  // Preliminary: industry/NAICS context is enough to scope; external sources strengthen it.
  const preliminary_source_status: SectionStatus = ctx.hasIndustry ? (hasExternal ? "pass" : "warn") : "fail";
  // Committee: must rely on government/market/trade sources — NOT the borrower website.
  const committee_source_status: SectionStatus = hasExternal ? "pass" : "warn";

  return {
    section,
    preliminary_source_status,
    committee_source_status,
    evidence_basis,
    detail: hasExternal
      ? "Backed by government/market/trade sources."
      : "Relies on industry classification; committee needs external government/market/trade sources.",
  };
}

function competitiveLandscape(ctx: SectionSourceContext): SectionSourceStatus {
  const hasStrong = has(ctx.sourceTypes, ...COMMITTEE_TYPES["Competitive Landscape"]);
  const evidence_basis: EvidenceBasis = hasStrong ? "public_web" : ctx.namedCompetitors > 0 ? "loan_file" : "insufficient";

  // Preliminary: named competitors with caveated source quality.
  const preliminary_source_status: SectionStatus = ctx.namedCompetitors >= 2 ? "pass" : ctx.namedCompetitors >= 1 ? "warn" : "fail";
  // Committee: needs stronger source support behind the named competitors.
  const committee_source_status: SectionStatus = hasStrong && ctx.namedCompetitors >= 2 ? "pass" : "warn";

  return {
    section: "Competitive Landscape",
    preliminary_source_status,
    committee_source_status,
    evidence_basis,
    detail: hasStrong && ctx.namedCompetitors >= 2
      ? "Named competitors backed by company/news/trade sources."
      : ctx.namedCompetitors > 0
        ? `${ctx.namedCompetitors} named competitor(s); committee needs stronger source support.`
        : "No named competitors identified.",
  };
}
