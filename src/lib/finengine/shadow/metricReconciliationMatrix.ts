/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 18: Shadow Reconciliation Matrix Expansion.
 *
 * Metric-by-metric reconciliation built on PR 2's shadow adapter (`MetricDiff`).
 * Classifies every canonical-mapped diff as ZERO / INTENDED / QUALITY_ADJUSTED /
 * UNEXPECTED / MISSING against an intentional-divergence registry, rolls up by
 * product, diffs provenance, and blocks cutover on any UNEXPECTED (unresolved)
 * divergence.
 *
 * This is the metric-level companion to the deal-set `reconciliationMatrix.ts`
 * (harness-level). Pure — read-only, no writes, no flags.
 */

import type {
  MetricDiff,
  StandardShadowComparison,
} from "@/lib/finengine/spread/standardShadowAdapter";

export type ReconStatus = "zero" | "intended" | "quality_adjusted" | "unexpected" | "missing";

/** Every divergence MUST be classified per safety rule 8. */
export type DivergenceKind = "intended" | "legacy_bug" | "finengine_bug" | "data_quality" | "quality_adjusted";

export type IntentionalDivergence = {
  canonicalMetricId: string;
  kind: DivergenceKind;
  reason: string;
};

/** metricId → registered divergence. Absence ⇒ any divergence is UNEXPECTED. */
export type IntentionalDivergenceRegistry = Record<string, IntentionalDivergence>;

export type ReconciledMetric = {
  canonicalMetricId: string;
  period: string;
  status: ReconStatus;
  legacyValue: number | null;
  finengineValue: number | null;
  relDiff: number | null;
  note: string;
};

export type ProductReconRollup = {
  product: string;
  zero: number;
  intended: number;
  qualityAdjusted: number;
  unexpected: number;
  missing: number;
  cutoverBlocked: boolean;
};

export type MetricReconciliationMatrix = {
  reconciled: ReconciledMetric[];
  counts: Record<ReconStatus, number>;
  unresolved: ReconciledMetric[];
  /** True when any UNEXPECTED divergence exists (safety rule: unresolved blocks cutover). */
  cutoverBlocked: boolean;
  /** Sanity: every canonical-mapped diff received a status. */
  everyCanonicalMetricHasStatus: boolean;
};

function emptyCounts(): Record<ReconStatus, number> {
  return { zero: 0, intended: 0, quality_adjusted: 0, unexpected: 0, missing: 0 };
}

/**
 * Classify one metric diff. `qualityAdjustedMetrics` marks metrics whose
 * divergence is expected because finengine ran in quality-adjusted mode.
 */
export function classifyMetricDiff(
  diff: MetricDiff,
  registry: IntentionalDivergenceRegistry,
  qualityAdjustedMetrics: ReadonlySet<string> = new Set(),
): ReconStatus | null {
  // Only canonical-mapped metrics are reconciled; structural/passthrough/unmapped
  // lines have no canonical status and are excluded from the matrix.
  if (!diff.canonicalMetricId) return null;

  switch (diff.status) {
    case "match":
      return "zero";
    case "missing_in_finengine":
    case "missing_in_legacy":
      return "missing";
    case "divergent": {
      if (qualityAdjustedMetrics.has(diff.canonicalMetricId)) return "quality_adjusted";
      const reg = registry[diff.canonicalMetricId];
      if (reg) return reg.kind === "quality_adjusted" ? "quality_adjusted" : "intended";
      return "unexpected";
    }
    default:
      // non_metric / unmapped are not canonical metrics.
      return null;
  }
}

function noteFor(status: ReconStatus, reg?: IntentionalDivergence): string {
  switch (status) {
    case "zero":
      return "Match within tolerance.";
    case "intended":
      return `Intended divergence (${reg?.kind ?? "intended"}): ${reg?.reason ?? ""}`;
    case "quality_adjusted":
      return "Divergence attributable to quality-adjusted mode.";
    case "unexpected":
      return "UNRESOLVED divergence — blocks cutover.";
    case "missing":
      return "Metric present on only one side.";
  }
}

export function buildMetricReconciliationMatrix(
  comparison: StandardShadowComparison,
  registry: IntentionalDivergenceRegistry = {},
  qualityAdjustedMetrics: ReadonlySet<string> = new Set(),
): MetricReconciliationMatrix {
  const reconciled: ReconciledMetric[] = [];
  const counts = emptyCounts();

  for (const diff of comparison.diffs) {
    const status = classifyMetricDiff(diff, registry, qualityAdjustedMetrics);
    if (status === null) continue; // not a canonical metric
    counts[status] += 1;
    reconciled.push({
      canonicalMetricId: diff.canonicalMetricId!,
      period: diff.period,
      status,
      legacyValue: diff.legacyValue,
      finengineValue: diff.finengineValue,
      relDiff: diff.relDiff,
      note: noteFor(status, registry[diff.canonicalMetricId!]),
    });
  }

  const unresolved = reconciled.filter((r) => r.status === "unexpected");
  return {
    reconciled,
    counts,
    unresolved,
    cutoverBlocked: unresolved.length > 0,
    everyCanonicalMetricHasStatus: reconciled.every((r) => !!r.status),
  };
}

/** Product-specific reconciliation: one comparison per product → per-product rollup. */
export function buildProductReconciliation(
  byProduct: Record<string, StandardShadowComparison>,
  registry: IntentionalDivergenceRegistry = {},
  qualityAdjustedMetrics: ReadonlySet<string> = new Set(),
): { rollups: ProductReconRollup[]; cutoverBlocked: boolean } {
  const rollups: ProductReconRollup[] = [];
  for (const [product, comparison] of Object.entries(byProduct)) {
    const m = buildMetricReconciliationMatrix(comparison, registry, qualityAdjustedMetrics);
    rollups.push({
      product,
      zero: m.counts.zero,
      intended: m.counts.intended,
      qualityAdjusted: m.counts.quality_adjusted,
      unexpected: m.counts.unexpected,
      missing: m.counts.missing,
      cutoverBlocked: m.cutoverBlocked,
    });
  }
  return { rollups, cutoverBlocked: rollups.some((r) => r.cutoverBlocked) };
}

// ── Provenance diffing ────────────────────────────────────────────────────────

export type ProvenanceDiff = {
  canonicalMetricId: string;
  legacySource: string | null;
  finengineSource: string | null;
  status: "match" | "mismatch" | "missing";
};

export function diffProvenance(
  canonicalMetricId: string,
  legacySource: string | null,
  finengineSource: string | null,
): ProvenanceDiff {
  let status: ProvenanceDiff["status"];
  if (legacySource == null || finengineSource == null) status = "missing";
  else status = legacySource === finengineSource ? "match" : "mismatch";
  return { canonicalMetricId, legacySource, finengineSource, status };
}
