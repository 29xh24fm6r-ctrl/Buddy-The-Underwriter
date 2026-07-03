/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 1: Finengine Registry Consolidation.
 *
 * Canonical FACT-KEY surface for the finengine registry package. Like the metric
 * surface, this owns no new vocabulary: it re-exports the frozen, report-only
 * fact-key vocabulary from `src/lib/finengine/factKeyRegistry.ts` (the single
 * source) and adds pure consolidation helpers. Two divergent fact-key registries
 * is exactly the drift PR 1 exists to prevent, so this is a re-export by design.
 *
 * Pure + standalone.
 */

import {
  CANONICAL_METRIC_KEYS,
  classifyFactKey,
  isCanonicalMetricKey,
  validateFactKey,
  type FactKeyClass,
} from "@/lib/finengine/factKeyRegistry";

export {
  CANONICAL_METRIC_KEYS,
  classifyFactKey,
  isCanonicalMetricKey,
  validateFactKey,
};
export type { FactKeyClass };

/**
 * Partition an arbitrary set of fact keys into the three vocabulary classes.
 * Pure; the sole purpose is to give the registry audit a single call to profile
 * a real deal's fact keys against the frozen vocabulary.
 */
export function partitionFactKeys(keys: Iterable<string>): {
  canonicalMetric: string[];
  extraction: string[];
  unknown: string[];
} {
  const canonicalMetric: string[] = [];
  const extraction: string[] = [];
  const unknown: string[] = [];
  for (const k of new Set(keys)) {
    const cls = classifyFactKey(k);
    if (cls === "canonical_metric") canonicalMetric.push(k);
    else if (cls === "extraction") extraction.push(k);
    else unknown.push(k);
  }
  return { canonicalMetric, extraction, unknown };
}
