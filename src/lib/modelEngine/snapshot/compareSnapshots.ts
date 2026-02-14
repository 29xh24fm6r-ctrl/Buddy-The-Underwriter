/**
 * Phase 13 — Metric-Only Snapshot Comparison
 *
 * Compares two sets of computed metric values.
 * Strictly metric-based — ignores explainability, dependencyGraph, timestamps.
 * Never mutates inputs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonThresholds {
  absoluteTolerance: number;
  percentTolerance: number;
}

export interface MetricDelta {
  key: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  deltaPercent: number | null;
  status: "unchanged" | "changed" | "added" | "removed";
}

export interface ComparisonSummary {
  totalMetrics: number;
  unchanged: number;
  changed: number;
  added: number;
  removed: number;
  maxAbsoluteDelta: number | null;
  maxPercentDelta: number | null;
}

export interface SnapshotComparison {
  deltas: MetricDelta[];
  summary: ComparisonSummary;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: ComparisonThresholds = {
  absoluteTolerance: 0.01,
  percentTolerance: 0.001, // 0.1%
};

// ---------------------------------------------------------------------------
// Core comparison
// ---------------------------------------------------------------------------

/**
 * Compare two sets of metric values.
 *
 * - before / after are Record<metricKey, number | null>
 * - Returns deltas for every key in the union of both sets
 * - Never mutates inputs
 */
export function compareSnapshotMetrics(
  before: Record<string, number | null>,
  after: Record<string, number | null>,
  thresholds?: Partial<ComparisonThresholds>,
): SnapshotComparison {
  const t: ComparisonThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const deltas: MetricDelta[] = [];

  let unchanged = 0;
  let changed = 0;
  let added = 0;
  let removed = 0;
  let maxAbsoluteDelta: number | null = null;
  let maxPercentDelta: number | null = null;

  for (const key of allKeys) {
    const hasBefore = key in before;
    const hasAfter = key in after;
    const bVal = hasBefore ? before[key] : null;
    const aVal = hasAfter ? after[key] : null;

    let status: MetricDelta["status"];
    let delta: number | null = null;
    let deltaPercent: number | null = null;

    if (!hasBefore && hasAfter) {
      status = "added";
      added++;
    } else if (hasBefore && !hasAfter) {
      status = "removed";
      removed++;
    } else {
      // Both exist — compute delta
      if (bVal === null && aVal === null) {
        status = "unchanged";
        unchanged++;
      } else if (bVal === null || aVal === null) {
        status = "changed";
        changed++;
        delta = aVal !== null ? aVal : (bVal !== null ? -bVal : null);
      } else {
        delta = aVal - bVal;
        deltaPercent = bVal !== 0 ? delta / Math.abs(bVal) : null;

        const absDelta = Math.abs(delta);
        const absPct = deltaPercent !== null ? Math.abs(deltaPercent) : 0;

        if (absDelta <= t.absoluteTolerance && absPct <= t.percentTolerance) {
          status = "unchanged";
          unchanged++;
        } else {
          status = "changed";
          changed++;
        }
      }
    }

    // Track max deltas
    if (delta !== null) {
      const abs = Math.abs(delta);
      if (maxAbsoluteDelta === null || abs > maxAbsoluteDelta) {
        maxAbsoluteDelta = abs;
      }
    }
    if (deltaPercent !== null) {
      const absPct = Math.abs(deltaPercent);
      if (maxPercentDelta === null || absPct > maxPercentDelta) {
        maxPercentDelta = absPct;
      }
    }

    deltas.push({ key, before: bVal, after: aVal, delta, deltaPercent, status });
  }

  return {
    deltas,
    summary: {
      totalMetrics: allKeys.size,
      unchanged,
      changed,
      added,
      removed,
      maxAbsoluteDelta,
      maxPercentDelta,
    },
  };
}
