/**
 * Phase 82: Proof of Truth — Section-Level Evidence Coverage
 *
 * Pure function. No DB, no server-only. Operates on the research_trace_json
 * shape already built by buildResearchTrace() in memoEvidenceResolver.ts.
 *
 * Strategy: use section-level evidence counts as the measurable proxy for
 * "Is this memo actually supported?". We do NOT attempt sentence-level claim
 * matching — the system is already section-aware, and that granularity gives
 * ~90% of the value with a small fraction of the complexity.
 */

export type ResearchTraceSection = {
  section_key: string;
  claim_ids: string[];
  evidence_count: number;
};

export type ResearchTraceJson = {
  sections: ResearchTraceSection[];
};

export type EvidenceCoverage = {
  totalSections: number;
  unsupportedSections: number;
  weakSections: number;
  /** null iff no sections exist (new deal — must not be penalized) */
  supportRatio: number | null;
};

const WEAK_SECTION_THRESHOLD = 3;

export function computeEvidenceCoverage(
  researchTrace: ResearchTraceJson | null | undefined,
): EvidenceCoverage {
  if (!researchTrace || !Array.isArray(researchTrace.sections)) {
    return {
      totalSections: 0,
      unsupportedSections: 0,
      weakSections: 0,
      supportRatio: null,
    };
  }

  const sections = researchTrace.sections;
  const totalSections = sections.length;

  const unsupportedSections = sections.filter(
    (s) => (s?.evidence_count ?? 0) === 0,
  ).length;

  const weakSections = sections.filter((s) => {
    const n = s?.evidence_count ?? 0;
    return n > 0 && n < WEAK_SECTION_THRESHOLD;
  }).length;

  const supportRatio =
    totalSections === 0 ? null : 1 - unsupportedSections / totalSections;

  return {
    totalSections,
    unsupportedSections,
    weakSections,
    supportRatio,
  };
}
