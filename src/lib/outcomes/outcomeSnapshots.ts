import "server-only";

/**
 * Phase 66C — Outcome Snapshots: Captures point-in-time outcome state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutcomeMetric } from "./outcomeMetrics";
import { rollupDealOutcomes } from "./outcomeRollups";

export type SnapshotType = "daily" | "weekly" | "milestone" | "final";

export interface OutcomeSnapshot {
  id: string;
  deal_id: string;
  bank_id: string;
  snapshot_type: SnapshotType;
  metrics: OutcomeMetric[];
  created_at: string;
}

/**
 * Rolls up deal outcomes and persists a point-in-time snapshot.
 * Returns the snapshot id.
 */
export async function captureOutcomeSnapshot(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
  snapshotType: SnapshotType,
): Promise<string> {
  const metrics = await rollupDealOutcomes(sb, dealId, bankId);

  const { data, error } = await sb
    .from("buddy_outcome_snapshots")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      snapshot_type: snapshotType,
      metrics,
    })
    .select("id")
    .single();

  if (error)
    throw new Error(`captureOutcomeSnapshot failed: ${error.message}`);
  return data.id as string;
}

/**
 * Returns the most recent outcome snapshot for a deal, or null if none exists.
 */
export async function getLatestSnapshot(
  sb: SupabaseClient,
  dealId: string,
): Promise<OutcomeSnapshot | null> {
  const { data, error } = await sb
    .from("buddy_outcome_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getLatestSnapshot failed: ${error.message}`);
  return data as OutcomeSnapshot | null;
}
