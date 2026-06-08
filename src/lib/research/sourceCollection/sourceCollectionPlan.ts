/**
 * SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-A
 *
 * Pure, deterministic planning layer that decides WHAT independent committee
 * source Buddy still needs (starting with Industry Validation) — without fetching
 * anything. It classifies what's already collected, suppresses duplicates, and
 * emits collection TARGETS (source families + collector IDs + acceptance rules),
 * never fabricated source URLs or citations. PR-B will execute collection.
 *
 * No DB / network / AI. No schema. No fabricated evidence. Never marks a source
 * collected or committee-grade.
 */

import type { DecisionEvidenceProjection } from "@/lib/research/committeeEvidenceProjection";

export type SourceCollectionStatus = "planned" | "review_existing_source" | "already_collected";
export type SourceCollectionPriority = "high" | "medium" | "low";

export interface SourceCollectionTarget {
  id: string;
  decisionArea: string;
  blockerType: string;
  sourcePurpose: string;
  sourceFamilies: string[];
  recommendedCollectors: string[];
  /** Evidence class the collected source must reach (PR #504 classes). */
  requiredEvidenceClass: string;
  priority: SourceCollectionPriority;
  searchInputs: Record<string, unknown>;
  acceptanceRules: string[];
  limitations: string[];
  idempotencyKey: string;
  status: SourceCollectionStatus;
  /** Existing committee task this target maps to (no duplicate task created). */
  linkedTaskId: string | null;
}

export interface CommitteeSourceCollectionPlan {
  dealId: string;
  generatedAt: string;
  targets: SourceCollectionTarget[];
  summary: string;
}

export interface SourceCollectionInput {
  dealId: string;
  generatedAt?: string;
  legalName?: string | null;
  dba?: string | null;
  website?: string | null;
  hqCity?: string | null;
  hqState?: string | null;
  naicsCode?: string | null;
  naicsDescription?: string | null;
  businessDescription?: string | null;
  customers?: string | null;
  customerProfile?: string | null;
  privateCompanyEvidenceMode?: boolean;
  currentCommitteeTasks?: Array<{ id?: string | null; task_type?: string | null }>;
  currentSourceSnapshots?: Array<{ source_type?: string | null; status?: string | null }>;
  currentDecisionEvidence?: DecisionEvidenceProjection | null;
}

const has = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/** A recognized INDEPENDENT industry/market source already collected (not the
 *  borrower's own website / SOS, which never satisfy the industry blocker). */
function hasIndependentIndustrySource(i: SourceCollectionInput): boolean {
  if (i.currentDecisionEvidence?.industry?.independentSource?.status === "Supported") return true;
  return (i.currentSourceSnapshots ?? []).some((s) => {
    const t = String(s.source_type ?? "");
    if (!/government_industry_data|bls|census|fred|ibisworld|statista|industry|market|trade/i.test(t)) return false;
    // borrower website / SOS are explicitly NOT industry sources.
    if (/website|\bsos\b|registry|secretary_of_state/i.test(t)) return false;
    return String(s.status ?? "") === "collected";
  });
}

function servesNationalCustomers(i: SourceCollectionInput): boolean {
  const hay = [i.customers, i.customerProfile, i.businessDescription].filter(has).join(" ");
  return /national|nationwide|enterprise|fortune\s*\d*|multi-?state|across the (us|country)/i.test(hay);
}

export function buildCommitteeSourceCollectionPlan(i: SourceCollectionInput): CommitteeSourceCollectionPlan {
  const generatedAt = i.generatedAt ?? "";
  const naics = has(i.naicsCode) ? String(i.naicsCode).trim() : null;
  const targets: SourceCollectionTarget[] = [];

  // ── Industry Validation target ───────────────────────────────────────────────
  const industryTask = (i.currentCommitteeTasks ?? []).find((t) => /industry_market_source/i.test(String(t.task_type ?? "")));
  const national = servesNationalCustomers(i);
  const alreadyHave = hasIndependentIndustrySource(i);

  const limitations = [
    i.privateCompanyEvidenceMode
      ? "Private company public footprint may be limited; independent industry data validates market context, not borrower-specific performance."
      : "Industry source validates market context, not borrower-specific performance.",
    national
      ? "National enterprise customer profile reduces the relevance of purely local market data; prioritize national industry context."
      : "Local market data may add context for a locally-focused borrower.",
  ];

  const searchInputs: Record<string, unknown> = {
    naicsCode: naics,
    naicsDescription: has(i.naicsDescription) ? i.naicsDescription : null,
    borrowerOperatingModel: has(i.businessDescription) ? i.businessDescription : null,
    geography: national ? "national first, local optional" : "national first, local recommended",
    hqState: has(i.hqState) ? i.hqState : null,
  };

  targets.push({
    id: "industry-validation-independent-source",
    decisionArea: "Industry Validation",
    blockerType: "independent_industry_source_missing",
    sourcePurpose: `Collect independent industry / market source support for NAICS ${naics ?? "(unknown)"} and the borrower operating model.`,
    sourceFamilies: ["government_industry_data", "market_research", "trade_publication"],
    recommendedCollectors: ["bls_naics_industry", "census_naics_industry", "fred_macro_context", "trade_publication_fallback"],
    // Prefer official government data; trade publications are acceptable as public_supported.
    requiredEvidenceClass: "official_supported",
    priority: alreadyHave ? "low" : "high",
    searchInputs,
    acceptanceRules: [
      "Prefer BLS / Census / FRED / government sources (official_supported).",
      "Trade publications are acceptable as public_supported, not official_supported.",
      national ? "Local geography is optional — the borrower serves national enterprise clients." : "Local geography is recommended for a locally-focused borrower.",
      "Do not mark committee_grade automatically unless deterministic rules already allow it.",
      "A newly collected source defaults to needs_review or committee_grade_candidate — never collected/committee_grade by collection alone.",
    ],
    limitations,
    idempotencyKey: `industry_validation:naics:${naics ?? "unknown"}`,
    status: alreadyHave ? "review_existing_source" : "planned",
    linkedTaskId: industryTask?.id ? String(industryTask.id) : null,
  });

  const planned = targets.filter((t) => t.status === "planned");
  const summary = planned.length === 0
    ? "All planned committee sources already have recognized independent support; review existing sources."
    : `${planned.length} committee source target(s) planned. Next: ${planned[0].decisionArea} — ${planned[0].sourcePurpose}`;

  return { dealId: i.dealId, generatedAt, targets, summary };
}
