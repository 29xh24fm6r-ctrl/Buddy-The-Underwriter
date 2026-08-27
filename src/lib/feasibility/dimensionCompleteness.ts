// src/lib/feasibility/dimensionCompleteness.ts
// One shared completeness measure for all four feasibility dimensions.
// Pure function. No DB, no LLM, no side effects.
//
// Before this module the four analyzers each computed `dataCompleteness`
// their own way — two spelled `dimensions.filter(d => d.dataAvailable).length
// / dimensions.length` inline, one hoisted the same expression into locals,
// and marketDemandAnalysis hand-rolled `dataPoints++` / `dataAvailable++`
// counters with an ad-hoc `dataPoints--` bolted on for the single metric that
// had grown a not-applicable branch. Three idioms, one of them mutable and
// order-dependent, all feeding a fail-closed release gate.
//
// Two corrections are folded in here, both of which the divergent versions
// got wrong:
//
//   1. Weight-aware. Every other number in the scorer is weight-driven, but
//      completeness counted a 0.30-weight metric and a 0.15-weight metric
//      identically. Coverage now measures the share of the DECISION that is
//      evidence-backed, which is what the figure is presented as — the PDF
//      prints it as "Data completeness: NN%".
//
//   2. Applicable-only denominator. A metric that does not bear on this
//      borrower is not an evidence gap. See DimensionScore.notApplicable.
//
// Fail-closed in both directions: a dimension with no applicable metric
// returns 0, never a vacuous 1.0 obtained by excluding everything.

import type { DimensionScore } from "./types";

export type DimensionCompleteness = {
  /** Applicable, evidence-backed share of the dimension's weight (0-1). */
  completeness: number;
  /** Summed weight of the metrics that bear on this borrower. */
  applicableWeight: number;
  /** Summed weight of every metric, applicable or not. */
  totalWeight: number;
  /** Metric keys that bear on this borrower but have no data. */
  missing: string[];
  /** Metric keys excluded from the denominator, with the reason. */
  notApplicable: Array<{ key: string; reason: string }>;
};

/**
 * Coverage for one dimension, keyed so callers can report exactly which
 * evidence is missing rather than only how much.
 */
export function computeDimensionCompleteness(
  entries: Array<{ key: string; score: DimensionScore }>,
): DimensionCompleteness {
  let applicableWeight = 0;
  let availableWeight = 0;
  let totalWeight = 0;
  const missing: string[] = [];
  const notApplicable: Array<{ key: string; reason: string }> = [];

  for (const { key, score } of entries) {
    const weight = Number.isFinite(score.weight) ? score.weight : 0;
    totalWeight += weight;

    if (score.notApplicable) {
      notApplicable.push({
        key,
        // An unexplained exclusion is the failure mode this guards against;
        // record it as unexplained rather than dropping it silently.
        reason: score.notApplicableReason ?? "no reason recorded",
      });
      continue;
    }

    applicableWeight += weight;
    if (score.dataAvailable) availableWeight += weight;
    else missing.push(key);
  }

  return {
    // No applicable metric means nothing was measured, not that everything
    // was covered.
    completeness: applicableWeight > 0 ? availableWeight / applicableWeight : 0,
    applicableWeight,
    totalWeight,
    missing,
    notApplicable,
  };
}
