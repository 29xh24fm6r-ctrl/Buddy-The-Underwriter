import "server-only";

/**
 * Phase 55B — Financial Evidence Change Handler
 *
 * Called when new material financial evidence arrives.
 * Diffs against active snapshot and triggers stale/rebuild as needed.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { diffSnapshots } from "./diffSnapshots";
import { markSnapshotStale } from "./markSnapshotStale";
import { shouldRebuildSnapshot, type RebuildTriggerEvent } from "./shouldRebuildSnapshot";
import type { FinancialSnapshotStatus } from "./types";

type EvidenceChangeInput = {
  dealId: string;
  bankId: string;
  triggerEvent: RebuildTriggerEvent;
  newFacts: Array<{ metricKey: string; periodKey: string; numericValue: number | null }>;
};

type EvidenceChangeResult = {
  staleMarked: boolean;
  shouldRebuild: boolean;
  rebuildReason: string;
  materialChanges: number;
};

/**
 * Handle new financial evidence: diff, stale detection, rebuild recommendation.
 */
export async function handleFinancialEvidenceChange(input: EvidenceChangeInput): Promise<EvidenceChangeResult> {
  const { dealId, bankId, triggerEvent, newFacts } = input;
  const sb = supabaseAdmin();

  // Load active snapshot facts
  const { data: activeSnapshot } = await sb
    .from("financial_snapshots_v2")
    .select("id, status")
    .eq("deal_id", dealId)
    .eq("active", true)
    .maybeSingle();

  if (!activeSnapshot) {
    const decision = shouldRebuildSnapshot({
      event: triggerEvent,
      currentSnapshotStatus: null,
      changedDocumentCount: 0,
      changedFactCount: newFacts.length,
      hasActiveSnapshot: false,
    });
    return {
      staleMarked: false,
      shouldRebuild: decision.shouldRebuild,
      rebuildReason: decision.reason,
      materialChanges: newFacts.length,
    };
  }

  // Load current snapshot facts for diff
  const { data: currentFactRows } = await sb
    .from("financial_snapshot_facts")
    .select("metric_key, period_key, numeric_value")
    .eq("snapshot_id", activeSnapshot.id);

  const currentFacts = (currentFactRows ?? []).map((f: any) => ({
    metricKey: f.metric_key,
    periodKey: f.period_key,
    numericValue: f.numeric_value != null ? Number(f.numeric_value) : null,
  }));

  // Diff
  const diff = diffSnapshots(currentFacts, newFacts);

  // Mark stale if material changes
  let staleMarked = false;
  if (diff.shouldMarkStale) {
    await markSnapshotStale({ dealId, bankId, reason: diff.materialitySummary });
    staleMarked = true;
  }

  // Determine rebuild
  const decision = shouldRebuildSnapshot({
    event: triggerEvent,
    currentSnapshotStatus: activeSnapshot.status as FinancialSnapshotStatus,
    changedDocumentCount: 0,
    changedFactCount: diff.changedFacts.length + diff.newFacts.length,
    hasActiveSnapshot: true,
  });

  return {
    staleMarked,
    shouldRebuild: decision.shouldRebuild,
    rebuildReason: decision.reason,
    materialChanges: diff.changedFacts.length + diff.newFacts.length + diff.removedFacts.length,
  };
}
