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
};

export type TridentReleaseGate = {
  ok: boolean;
  reasons: string[];
};

function wordCount(value: unknown): number {
  return typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

/** Deterministic, fail-closed release gate for one complete Golden Trident run. */
export function evaluateTridentRelease(e: TridentReleaseEvidence): TridentReleaseGate {
  const reasons: string[] = [];
  if (e.businessPlanVerdict !== "pass") reasons.push("business_plan_review_not_passed");
  if (e.feasibilityVerdict !== "pass") reasons.push("feasibility_review_not_passed");
  const completeness = Number(e.feasibilityCompleteness ?? 0);
  if (!(completeness >= 0.7 || completeness >= 70)) reasons.push("feasibility_data_completeness_below_70_percent");
  if (e.feasibilityCitationCount < 3) reasons.push("feasibility_citation_coverage_below_three_sections");
  if (wordCount(e.projectionsNarrative) < 35) reasons.push("projection_assumptions_narrative_not_substantive");

  const su = e.sourcesAndUses as { balanced?: unknown; imbalance?: unknown } | null;
  if (!su || su.balanced !== true || Math.abs(Number(su.imbalance ?? 0)) > 1) {
    reasons.push("sources_and_uses_not_reconciled");
  }
  if (!e.memoId) reasons.push("canonical_credit_memo_missing");
  if (!e.memoInputHash || e.memoInputHash !== e.expectedMemoInputHash) reasons.push("canonical_credit_memo_stale");
  if (e.memoResearchTrustGrade !== "committee_grade") reasons.push("memo_research_not_committee_grade");
  if (!e.spreadId || !e.spreadReady) reasons.push("canonical_spread_not_ready");
  if (!e.spreadHasIntegrityHash) reasons.push("canonical_spread_integrity_hash_missing");
  if (!e.spreadHasCanonicalFactsTimestamp) reasons.push("canonical_spread_facts_timestamp_missing");
  if (e.artifactPaths.some((path) => !path)) reasons.push("required_rendered_artifact_missing");

  return { ok: reasons.length === 0, reasons };
}
