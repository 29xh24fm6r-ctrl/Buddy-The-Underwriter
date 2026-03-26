/**
 * Phase 55A — Snapshot Diff + Staleness Detection
 *
 * Compares two snapshots (or a snapshot vs new extracted facts)
 * to detect material changes and determine staleness.
 *
 * Pure function — no DB calls.
 */

import type { SnapshotDiff } from "./types";

type FactSummary = {
  metricKey: string;
  periodKey: string;
  numericValue: number | null;
};

/**
 * Diff two sets of financial facts to detect changes.
 */
export function diffSnapshots(
  currentFacts: FactSummary[],
  newFacts: FactSummary[],
): SnapshotDiff {
  const currentMap = new Map<string, FactSummary>();
  for (const f of currentFacts) {
    currentMap.set(`${f.metricKey}::${f.periodKey}`, f);
  }

  const newMap = new Map<string, FactSummary>();
  for (const f of newFacts) {
    newMap.set(`${f.metricKey}::${f.periodKey}`, f);
  }

  const changed: SnapshotDiff["changedFacts"] = [];
  const removed: SnapshotDiff["removedFacts"] = [];
  const added: SnapshotDiff["newFacts"] = [];

  // Find changed and removed
  for (const [key, cur] of currentMap) {
    const next = newMap.get(key);
    if (!next) {
      removed.push({ metricKey: cur.metricKey, period: cur.periodKey });
    } else if (cur.numericValue !== next.numericValue) {
      changed.push({
        metricKey: cur.metricKey,
        period: cur.periodKey,
        oldValue: cur.numericValue,
        newValue: next.numericValue,
      });
    }
  }

  // Find new
  for (const [key, next] of newMap) {
    if (!currentMap.has(key)) {
      added.push({ metricKey: next.metricKey, period: next.periodKey, value: next.numericValue });
    }
  }

  const totalChanges = changed.length + removed.length + added.length;
  const shouldMarkStale = changed.length > 0 || removed.length > 0;
  const shouldAutoRebuild = totalChanges > 0;

  const materialitySummary = totalChanges === 0
    ? "No material changes detected"
    : `${changed.length} changed, ${added.length} new, ${removed.length} removed fact(s)`;

  return {
    changedFacts: changed,
    removedFacts: removed,
    newFacts: added,
    materialitySummary,
    shouldMarkStale,
    shouldAutoRebuild,
  };
}
