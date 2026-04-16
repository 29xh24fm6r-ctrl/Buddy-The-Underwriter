import "server-only";

/**
 * Phase 82: Proof of Truth — Memo Evidence Aggregation
 *
 * Builds the inputs the memo-time evidence gates need, from the already-
 * normalized MemoEvidenceRow collection:
 *
 *   - evidence coverage (section support ratio)
 *   - inference ratio per section (for UI visibility)
 *   - contradiction check coverage (which required checks appear in synthesis
 *     contradictions) — re-uses the same regex patterns Gate 7 uses
 *   - primary-source-backed contradiction strength summary
 *
 * Reads from loadAllEvidenceForDeal() which normalizes supporting_data →
 * flat properties. No direct DB access here.
 */

import { loadAllEvidenceForDeal, type MemoEvidenceRow } from "./memoEvidenceResolver";
import {
  computeEvidenceCoverage,
  type EvidenceCoverage,
  type ResearchTraceJson,
} from "./evidenceCoverage";
import {
  computeContradictionStrengthSummary,
  type ContradictionStrengthSummary,
} from "./contradictionStrength";
import {
  REQUIRED_CONTRADICTION_CHECKS,
  type ContradictionCheckKey,
} from "./completionGate";

/**
 * Same regex patterns as the internal CHECK_PATTERNS in completionGate.ts.
 * Duplicated intentionally so this module does not force the gate file to
 * export its private maps. If the patterns ever drift, the drift will show
 * up in the audit CLI before it affects trust.
 */
const CHECK_PATTERNS: Record<ContradictionCheckKey, RegExp[]> = {
  identity_mismatch: [
    /\bname.*mismatch\b/i, /\bentity.*mismatch\b/i, /\blegal\s+name\b/i,
    /\bidentity\b/i, /\bUNVALIDATED_MANAGEMENT_PROFILE\b/,
  ],
  dba_mismatch: [
    /\bdba\b/i, /\bdoing\s+business\s+as\b/i, /\btrade\s*name\b/i,
  ],
  geography_mismatch: [
    /\bgeograph/i, /\blocation\b/i, /\bmarket.*different\b/i,
    /\bcompetitor.*different\s+market\b/i,
  ],
  scale_plausibility: [
    /\bscale\b/i, /\brevenue.*plausib/i, /\bhead\s*count\b/i,
    /\bsize.*inconsist/i, /\brevenue\b.*\bmatch\b/i,
  ],
  management_history_conflict: [
    /\bmanagement\b/i, /\bprincipal\b/i, /\bbackground\b/i,
    /\bhistory.*conflict\b/i, /\bexperience\b/i,
  ],
  regulatory_vs_margin: [
    /\bregulat/i, /\bcompliance\b/i, /\bmargin\b/i,
    /\blicens/i, /\benforcement\b/i,
  ],
  competitive_position_conflict: [
    /\bcompetit/i, /\bmarket\s*share\b/i, /\bposition/i,
    /\badvantage\b/i,
  ],
  repayment_story_conflict: [
    /\brepayment\b/i, /\bcash\s*flow\b/i, /\bdebt\s*service\b/i,
    /\bDSCR\b/i, /\bability\s+to\s+repay\b/i,
  ],
};

/**
 * Determine which REQUIRED_CONTRADICTION_CHECKS appear in the supplied
 * synthesis contradiction texts. Pure function — exported for the audit CLI.
 */
export function detectCoveredContradictionChecks(
  contradictionTexts: readonly string[],
): ContradictionCheckKey[] {
  const allText = contradictionTexts.join(" ");
  return REQUIRED_CONTRADICTION_CHECKS.filter((key) =>
    CHECK_PATTERNS[key].some((p) => p.test(allText)),
  );
}

export type MemoEvidenceAggregate = {
  coverage: EvidenceCoverage;
  researchTrace: ResearchTraceJson | null;
  /** sectionKey → { inference, total, ratio } — ratio in [0,1] or null when total=0 */
  inferenceBySection: Record<string, { inference: number; total: number; ratio: number | null }>;
  contradictionStrength: ContradictionStrengthSummary;
  coveredContradictionChecks: ContradictionCheckKey[];
  /** All unique source URIs across the mission's evidence rows */
  sourceUrls: string[];
  /** true iff a completed research mission exists for this deal */
  hasMission: boolean;
};

function buildResearchTraceFromGrouped(
  grouped: Map<string, MemoEvidenceRow[]>,
): ResearchTraceJson | null {
  if (grouped.size === 0) return null;
  const sections = Array.from(grouped.entries()).map(([section_key, rows]) => ({
    section_key,
    claim_ids: rows.map((r) => r.id),
    evidence_count: rows.length,
  }));
  return { sections };
}

function computeInferenceBySection(
  grouped: Map<string, MemoEvidenceRow[]>,
): Record<string, { inference: number; total: number; ratio: number | null }> {
  const out: Record<string, { inference: number; total: number; ratio: number | null }> = {};
  for (const [section, rows] of grouped.entries()) {
    const total = rows.length;
    const inference = rows.filter((r) => r.layer === "inference").length;
    out[section] = {
      inference,
      total,
      ratio: total === 0 ? null : inference / total,
    };
  }
  return out;
}

function extractSourceUrls(grouped: Map<string, MemoEvidenceRow[]>): string[] {
  const set = new Set<string>();
  for (const rows of grouped.values()) {
    for (const r of rows) {
      for (const u of r.source_uris ?? []) {
        if (u) set.add(u);
      }
    }
  }
  return Array.from(set);
}

/**
 * Build the full Phase 82 aggregate for a deal. Safe to call when no
 * research mission exists — returns a zero-state aggregate with null ratios.
 */
export async function buildMemoEvidenceAggregate(
  dealId: string,
): Promise<MemoEvidenceAggregate> {
  const grouped = await loadAllEvidenceForDeal(dealId);
  const hasMission = grouped.size > 0;

  const researchTrace = buildResearchTraceFromGrouped(grouped);
  const coverage = computeEvidenceCoverage(researchTrace);
  const inferenceBySection = computeInferenceBySection(grouped);
  const sourceUrls = extractSourceUrls(grouped);

  const contradictionRows = grouped.get("Contradictions") ?? [];
  const contradictionTexts = contradictionRows.map((r) => r.claim_text);
  const coveredContradictionChecks = detectCoveredContradictionChecks(contradictionTexts);
  const contradictionStrength = computeContradictionStrengthSummary(
    coveredContradictionChecks,
    sourceUrls,
  );

  return {
    coverage,
    researchTrace,
    inferenceBySection,
    contradictionStrength,
    coveredContradictionChecks,
    sourceUrls,
    hasMission,
  };
}
