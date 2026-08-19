import "server-only";

export type TridentReleaseEvidence = {
  businessPlanVerdict: unknown;
  feasibilityVerdict: unknown;
  feasibilityCompleteness: unknown;
  feasibilityCitationCount: number;
  projectionsNarrative: unknown;
  sourcesAndUses: unknown;
  memoId: string | null;
  memoInputHash: string | null;
  expectedMemoInputHash: string;
  memoResearchTrustGrade: string | null;
  spreadId: string | null;
  spreadReady: boolean;
  spreadHasIntegrityHash: boolean;
  spreadHasCanonicalFactsTimestamp: boolean;
  artifactPaths: Array<string | null>;
  isTestDeal: boolean;
};

export type TridentReleaseGate = {
  ok: boolean;
  reasons: string[];
  warnings: string[];
};

function wordCount(value: unknown): number {
  return typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

/**
 * Research policy shared by admission and release.
 *
 * Private-company research can legitimately top out at preliminary when the
 * loan file is strong but the borrower has a limited public footprint. That
 * is reviewable institutional evidence, not a generation failure. Missing or
 * weaker research remains fail-closed for real deals. Synthetic QA deals are
 * visibly marked and may commission the artifact factory without fabricating
 * a public research mission for a fictional company.
 */
export function evaluateTridentResearchTrust(args: {
  trustGrade: string | null;
  isTestDeal: boolean;
}): { reasons: string[]; warnings: string[] } {
  if (args.trustGrade === "committee_grade") return { reasons: [], warnings: [] };
  if (args.trustGrade === "preliminary") {
    return { reasons: [], warnings: ["memo_research_preliminary_requires_lender_review"] };
  }
  if (args.isTestDeal && !args.trustGrade) {
    return { reasons: [], warnings: ["synthetic_qa_deal_has_no_public_research_grade"] };
  }
  return {
    reasons: ["memo_research_not_release_ready"],
    warnings: [],
  };
}

/** Deterministic, fail-closed release gate for one complete Golden Trident run. */
export function evaluateTridentRelease(e: TridentReleaseEvidence): TridentReleaseGate {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (e.businessPlanVerdict !== "pass") reasons.push("business_plan_review_not_passed");
  if (e.feasibilityVerdict !== "pass") reasons.push("feasibility_review_not_passed");
  const completeness = Number(e.feasibilityCompleteness ?? 0);
  if (!(completeness >= 0.7 || completeness >= 70)) reasons.push("feasibility_data_completeness_below_70_percent");
  if (e.feasibilityCitationCount < 3) {
    if (e.isTestDeal) warnings.push("synthetic_qa_citation_coverage_below_three_sections");
    else reasons.push("feasibility_citation_coverage_below_three_sections");
  }
  if (wordCount(e.projectionsNarrative) < 35) reasons.push("projection_assumptions_narrative_not_substantive");

  const su = e.sourcesAndUses as { balanced?: unknown; imbalance?: unknown } | null;
  if (!su || su.balanced !== true || Math.abs(Number(su.imbalance ?? 0)) > 1) {
    reasons.push("sources_and_uses_not_reconciled");
  }
  if (!e.memoId) reasons.push("canonical_credit_memo_missing");
  if (!e.memoInputHash || e.memoInputHash !== e.expectedMemoInputHash) reasons.push("canonical_credit_memo_stale");

  const research = evaluateTridentResearchTrust({
    trustGrade: e.memoResearchTrustGrade,
    isTestDeal: e.isTestDeal,
  });
  reasons.push(...research.reasons);
  warnings.push(...research.warnings);

  if (!e.spreadId || !e.spreadReady) reasons.push("canonical_spread_not_ready");
  if (!e.spreadHasIntegrityHash) reasons.push("canonical_spread_integrity_hash_missing");
  if (!e.spreadHasCanonicalFactsTimestamp) reasons.push("canonical_spread_facts_timestamp_missing");
  if (e.artifactPaths.some((path) => !path)) reasons.push("required_rendered_artifact_missing");

  return { ok: reasons.length === 0, reasons, warnings };
}
