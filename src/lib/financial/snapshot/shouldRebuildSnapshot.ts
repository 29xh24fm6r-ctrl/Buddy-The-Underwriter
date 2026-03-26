/**
 * Phase 55B — Snapshot Rebuild Trigger Registry
 *
 * Explicit, deterministic rules for when a snapshot rebuild should occur.
 * Pure function — no DB calls.
 */

import type { FinancialSnapshotStatus } from "./types";

export type RebuildTriggerEvent =
  | "extraction_completed"
  | "spread_recomputed"
  | "banker_fact_adjustment"
  | "stale_snapshot_detected"
  | "document_replaced"
  | "manual_rebuild_requested";

type RebuildInput = {
  event: RebuildTriggerEvent;
  currentSnapshotStatus: FinancialSnapshotStatus | null;
  changedDocumentCount: number;
  changedFactCount: number;
  hasActiveSnapshot: boolean;
};

type RebuildDecision = {
  shouldRebuild: boolean;
  reason: string;
  priority: "immediate" | "deferred" | "none";
};

/**
 * Determine whether a snapshot rebuild should occur.
 */
export function shouldRebuildSnapshot(input: RebuildInput): RebuildDecision {
  const { event, currentSnapshotStatus, changedDocumentCount, changedFactCount, hasActiveSnapshot } = input;

  // No active snapshot — always build
  if (!hasActiveSnapshot) {
    return { shouldRebuild: true, reason: `No active snapshot — building from ${event}`, priority: "immediate" };
  }

  // Manual request always honored
  if (event === "manual_rebuild_requested") {
    return { shouldRebuild: true, reason: "Manual rebuild requested", priority: "immediate" };
  }

  // Stale snapshot should be rebuilt if new data available
  if (event === "stale_snapshot_detected" || currentSnapshotStatus === "stale") {
    return { shouldRebuild: true, reason: "Active snapshot is stale — rebuilding with latest evidence", priority: "immediate" };
  }

  // Extraction or spread changes with material impact
  if ((event === "extraction_completed" || event === "spread_recomputed") && changedFactCount > 0) {
    return { shouldRebuild: true, reason: `${changedFactCount} fact(s) changed from ${event}`, priority: "immediate" };
  }

  // Document replacement
  if (event === "document_replaced" && changedDocumentCount > 0) {
    return { shouldRebuild: true, reason: `${changedDocumentCount} document(s) replaced`, priority: "immediate" };
  }

  // Banker adjustment — rebuild to pick up new validated values
  if (event === "banker_fact_adjustment") {
    return { shouldRebuild: false, reason: "Banker adjustment applied in-place — no full rebuild needed", priority: "none" };
  }

  // No material trigger
  if (changedFactCount === 0 && changedDocumentCount === 0) {
    return { shouldRebuild: false, reason: "No material changes detected", priority: "none" };
  }

  return { shouldRebuild: true, reason: `Trigger: ${event}`, priority: "deferred" };
}
