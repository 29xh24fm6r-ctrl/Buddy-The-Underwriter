/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 23: Classic Spread / Memo Shadow Adapter.
 *
 * Compares the legacy classic PDF/memo output against the finengine memo
 * intelligence contract (PR 22) — WITHOUT changing any live memo behavior. Pure
 * audit producer: missing-section detector, metric-mismatch detector, and a
 * memo-conclusion support audit. It never renders and never writes.
 */

import type { MemoCreditAnalysis } from "@/lib/finengine/memo/memoIntelligenceContract";

/** A minimal snapshot of what the legacy classic memo rendered. */
export type LegacyMemoSnapshot = {
  /** Section keys present in the legacy memo (normalized upper-snake). */
  sections: string[];
  /** Metric values the legacy memo showed. */
  metrics: {
    dscr?: number | null;
    globalDscr?: number | null;
    collateralCoverage?: number | null;
  };
  /** Conclusion strings the legacy memo asserted (for the support audit). */
  conclusions?: string[];
};

/** The sections the finengine contract expects a complete memo to carry. */
export const EXPECTED_MEMO_SECTIONS = [
  "EXECUTIVE_SUMMARY",
  "REPAYMENT_ANALYSIS",
  "GLOBAL_CASH_FLOW",
  "COLLATERAL",
  "EXAMINER_CONCERNS",
  "COVENANTS",
  "APPROVAL_CONDITIONS",
] as const;

export type ExpectedSection = (typeof EXPECTED_MEMO_SECTIONS)[number];

export type MetricMismatch = {
  metric: "dscr" | "globalDscr" | "collateralCoverage";
  legacy: number | null;
  finengine: number | null;
  relDiff: number | null;
};

export type ClassicMemoShadowAudit = {
  missingSections: ExpectedSection[];
  metricMismatches: MetricMismatch[];
  /** Conclusions the finengine contract cannot back with a certified support. */
  unsupportedConclusions: string[];
  /** True when no missing sections and no metric mismatches. */
  ok: boolean;
};

function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/[\s/-]+/g, "_");
}

/** Which expected sections the finengine contract actually populated. */
function finengineSectionsPresent(memo: MemoCreditAnalysis): Set<ExpectedSection> {
  const present = new Set<ExpectedSection>();
  present.add("EXECUTIVE_SUMMARY");
  present.add("REPAYMENT_ANALYSIS");
  if (memo.repayment.globalDscr != null) present.add("GLOBAL_CASH_FLOW");
  present.add("COLLATERAL");
  if (memo.examiner.criticisms.length > 0) present.add("EXAMINER_CONCERNS");
  if (memo.covenants.package.length > 0) present.add("COVENANTS");
  if (memo.approvalConditions.conditions.length > 0) present.add("APPROVAL_CONDITIONS");
  return present;
}

function relDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b)) || 1;
  return Math.abs(a - b) / denom;
}

function compareMetric(
  metric: MetricMismatch["metric"],
  legacy: number | null | undefined,
  finengine: number | null,
  rtol: number,
): MetricMismatch | null {
  if (legacy == null || finengine == null) return null; // only compare when both present
  const d = relDiff(legacy, finengine);
  if (d <= rtol) return null;
  return { metric, legacy, finengine, relDiff: d };
}

/**
 * Audit the legacy memo against the finengine contract. A section the finengine
 * contract carries but the legacy memo lacks is a missing section; a metric both
 * show but that disagree is a mismatch.
 */
export function auditClassicMemoAgainstContract(
  legacy: LegacyMemoSnapshot,
  memo: MemoCreditAnalysis,
  rtol = 1e-3,
): ClassicMemoShadowAudit {
  const legacySections = new Set(legacy.sections.map(normalize));
  const fePresent = finengineSectionsPresent(memo);

  const missingSections = EXPECTED_MEMO_SECTIONS.filter(
    (s) => fePresent.has(s) && !legacySections.has(s),
  );

  const metricMismatches = [
    compareMetric("dscr", legacy.metrics.dscr, memo.repayment.dscr, rtol),
    compareMetric("globalDscr", legacy.metrics.globalDscr, memo.repayment.globalDscr, rtol),
    compareMetric("collateralCoverage", legacy.metrics.collateralCoverage, memo.collateral.coverage, rtol),
  ].filter((m): m is MetricMismatch => m !== null);

  // Conclusion support audit: a legacy conclusion is "supported" if the contract
  // is certified (assembled solely from certified objects). Absent certification,
  // every conclusion is flagged as potentially prose-derived.
  const unsupportedConclusions = memo.certified === true ? [] : (legacy.conclusions ?? []);

  return {
    missingSections,
    metricMismatches,
    unsupportedConclusions,
    ok: missingSections.length === 0 && metricMismatches.length === 0,
  };
}
