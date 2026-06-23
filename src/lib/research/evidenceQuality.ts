/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 5
 *
 * Evidence lanes + certified-coverage scorer.
 *
 * Buddy previously gated on a single, public-source-heavy score. That conflates
 * "we couldn't find much on the public web" with "this is a weak credit file."
 * They are different. This scorer separates the evidence into three lanes:
 *
 *   - public_web_quality_score      — quality of third-party public sources
 *   - loan_file_evidence_score      — structured loan-file evidence (financials,
 *                                     identity, collateral, request)
 *   - banker_certified_evidence_score — banker-attested business context
 *
 * `certified_evidence_coverage_score` blends the file + banker-certified lanes
 * (public web excluded) — this is what supports PRELIMINARY underwriting.
 * Committee additionally requires public/attested verification.
 *
 * A wrong/conflicting public entity makes both eligibility flags hard-false.
 *
 * Pure module (no server-only, no DB) — fully unit-testable.
 */

export type EvidenceLane = "public_web" | "loan_file" | "banker_certified";

export type EvidenceQualityResult = {
  public_web_quality_score: number;
  loan_file_evidence_score: number;
  banker_certified_evidence_score: number;
  certified_evidence_coverage_score: number;
  preliminary_eligible: boolean;
  committee_eligible: boolean;
  present_items: string[];
  missing_items: string[];
  limitations: string[];
  strengths: string[];
  public_web_limited: boolean;
  private_company_evidence_mode: boolean;
};

export type EvidenceQualityInput = {
  /** Hard conflict — wrong/conflicting public entity. Forces both flags false. */
  entityConflict: boolean;
  /** Entity confirmed against a public source at committee confidence. */
  entityLockConfirmedPublicly: boolean;

  // Identity
  hasLegalName: boolean;
  hasWebsite: boolean;
  hasHqLocation: boolean;
  hasBankerIdentitySummary: boolean;

  // Industry
  hasNaics: boolean;
  hasIndustryDescription: boolean;

  // Business (banker-certified context)
  hasBusinessDescription: boolean;
  hasProductsServices: boolean;
  hasCustomerAnchors: boolean;
  hasCompetitivePosition: boolean;

  // Management
  managementProfileOnFile: boolean;
  managementPubliclyConfirmed: boolean;

  // Financials
  hasRevenue: boolean;
  hasDscr: boolean;
  hasFinancialStatements: boolean;

  // Collateral / request
  hasLoanRequest: boolean;
  hasCollateral: boolean;

  // Public web
  publicSourceCount: number;
  primaryInstitutionalCount: number;
  publicQualityScore: number; // 0–1 from computeSourceQualityScore

  privateCompanyMode: boolean;
};

type Item = { key: string; label: string; lane: EvidenceLane; weight: number; present: boolean };

export const PRELIMINARY_COVERAGE_THRESHOLD = 0.65;
export const COMMITTEE_COVERAGE_THRESHOLD = 0.85;
export const COMMITTEE_MIN_PUBLIC_QUALITY = 0.5;
export const COMMITTEE_MIN_PRIMARY_SOURCES = 2;

function buildItems(i: EvidenceQualityInput): Item[] {
  return [
    // Identity
    { key: "legal_name", label: "Legal name on file", lane: "loan_file", weight: 1.0, present: i.hasLegalName },
    { key: "website", label: "Website on file", lane: "loan_file", weight: 0.5, present: i.hasWebsite },
    { key: "hq_location", label: "HQ location on file", lane: "loan_file", weight: 0.5, present: i.hasHqLocation },
    { key: "banker_identity", label: "Banker identity summary", lane: "banker_certified", weight: 1.0, present: i.hasBankerIdentitySummary },
    // Industry
    { key: "naics", label: "NAICS code", lane: "loan_file", weight: 0.5, present: i.hasNaics },
    { key: "industry_description", label: "Industry description", lane: "banker_certified", weight: 0.5, present: i.hasIndustryDescription },
    // Business
    { key: "business_description", label: "Business description", lane: "banker_certified", weight: 1.5, present: i.hasBusinessDescription },
    { key: "products_services", label: "Products / services", lane: "banker_certified", weight: 0.5, present: i.hasProductsServices },
    { key: "customer_anchors", label: "Customer anchors", lane: "banker_certified", weight: 0.5, present: i.hasCustomerAnchors },
    { key: "competitive_position", label: "Competitive position", lane: "banker_certified", weight: 0.5, present: i.hasCompetitivePosition },
    // Management
    { key: "management_profile", label: "Management profile on file", lane: "banker_certified", weight: 1.0, present: i.managementProfileOnFile },
    { key: "management_public", label: "Management publicly verified", lane: "public_web", weight: 1.0, present: i.managementPubliclyConfirmed },
    // Financials (heavily weighted — a credit file without financials cannot be preliminary-ready)
    { key: "revenue", label: "Total revenue", lane: "loan_file", weight: 2.0, present: i.hasRevenue },
    { key: "dscr", label: "DSCR", lane: "loan_file", weight: 1.0, present: i.hasDscr },
    { key: "financial_statements", label: "Financial statements / tax returns", lane: "loan_file", weight: 2.0, present: i.hasFinancialStatements },
    // Collateral / request
    { key: "loan_request", label: "Loan request / use of proceeds", lane: "loan_file", weight: 0.5, present: i.hasLoanRequest },
    { key: "collateral", label: "Collateral records", lane: "loan_file", weight: 0.5, present: i.hasCollateral },
    // Public web
    { key: "entity_public", label: "Entity publicly confirmed", lane: "public_web", weight: 1.0, present: i.entityLockConfirmedPublicly },
    { key: "public_sources", label: "Public sources present", lane: "public_web", weight: 0.5, present: i.publicSourceCount > 0 },
    { key: "primary_sources", label: "Primary/institutional sources", lane: "public_web", weight: 1.0, present: i.primaryInstitutionalCount > 0 },
  ];
}

function laneScore(items: Item[], lane: EvidenceLane): number {
  const inLane = items.filter((it) => it.lane === lane);
  const total = inLane.reduce((s, it) => s + it.weight, 0);
  if (total === 0) return 0;
  const present = inLane.filter((it) => it.present).reduce((s, it) => s + it.weight, 0);
  return round2(present / total);
}

export function scoreEvidenceQuality(i: EvidenceQualityInput): EvidenceQualityResult {
  const items = buildItems(i);

  const public_web_quality_score = round2(clamp01(i.publicQualityScore));
  const loan_file_evidence_score = laneScore(items, "loan_file");
  const banker_certified_evidence_score = laneScore(items, "banker_certified");

  // Coverage that supports preliminary = file + banker-certified lanes only.
  const certifiedItems = items.filter((it) => it.lane !== "public_web");
  const certTotal = certifiedItems.reduce((s, it) => s + it.weight, 0);
  const certPresent = certifiedItems.filter((it) => it.present).reduce((s, it) => s + it.weight, 0);
  const certified_evidence_coverage_score = certTotal === 0 ? 0 : round2(certPresent / certTotal);

  const public_web_limited = i.publicSourceCount < 5 || i.primaryInstitutionalCount === 0;
  const private_company_evidence_mode =
    i.privateCompanyMode ||
    (banker_certified_evidence_score >= 0.6 && public_web_limited);

  // Eligibility
  const preliminary_eligible =
    !i.entityConflict &&
    certified_evidence_coverage_score >= PRELIMINARY_COVERAGE_THRESHOLD;

  const committee_eligible =
    !i.entityConflict &&
    certified_evidence_coverage_score >= COMMITTEE_COVERAGE_THRESHOLD &&
    public_web_quality_score >= COMMITTEE_MIN_PUBLIC_QUALITY &&
    i.primaryInstitutionalCount >= COMMITTEE_MIN_PRIMARY_SOURCES &&
    i.entityLockConfirmedPublicly;

  const present_items = items.filter((it) => it.present).map((it) => it.label);
  const missing_items = items.filter((it) => !it.present).map((it) => it.label);

  const strengths: string[] = [];
  if (banker_certified_evidence_score >= 0.6) strengths.push("Strong banker-certified business context on file");
  if (loan_file_evidence_score >= 0.6) strengths.push("Strong loan-file evidence (financials/identity/collateral)");
  if (public_web_quality_score >= 0.6) strengths.push("Good-quality public sources");
  if (i.entityLockConfirmedPublicly) strengths.push("Entity publicly confirmed");

  const limitations: string[] = [];
  if (i.entityConflict) limitations.push("Wrong/conflicting public entity — identity must be resolved before any reliance");
  if (public_web_limited) limitations.push("Public web footprint is limited (expected for a private borrower)");
  if (i.primaryInstitutionalCount === 0) limitations.push("No primary/institutional public sources found");
  if (!i.hasRevenue || !i.hasFinancialStatements) limitations.push("Financial statements/figures incomplete");
  if (!i.managementPubliclyConfirmed) limitations.push("Management not publicly verified");

  return {
    public_web_quality_score,
    loan_file_evidence_score,
    banker_certified_evidence_score,
    certified_evidence_coverage_score,
    preliminary_eligible,
    committee_eligible,
    present_items,
    missing_items,
    limitations,
    strengths,
    public_web_limited,
    private_company_evidence_mode,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
