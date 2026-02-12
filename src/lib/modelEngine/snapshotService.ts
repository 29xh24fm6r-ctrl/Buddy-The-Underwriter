/**
 * Model Engine V2 — Snapshot Service
 *
 * Persists model computation results to deal_model_snapshots for audit trail.
 * NOT called automatically — Phase 1 only exposes manual save via preview endpoint.
 */

import type { ModelSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Save snapshot
// ---------------------------------------------------------------------------

/**
 * Save a model computation snapshot to the database.
 *
 * @param supabase - Supabase admin client
 * @param snapshot - Snapshot data to persist
 * @param computedMetrics - Full metric values map
 * @param riskFlags - Risk flags from evaluation
 * @returns The inserted snapshot ID, or null on failure
 */
export async function saveModelSnapshot(
  supabase: any,
  snapshot: ModelSnapshot,
  computedMetrics: Record<string, number | null>,
  riskFlags: Array<{ key: string; value: number; threshold: number; severity: string }>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase
    .from("deal_model_snapshots")
    .insert({
      deal_id: snapshot.dealId,
      bank_id: snapshot.bankId,
      model_version: snapshot.modelVersion,
      metric_registry_hash: snapshot.metricRegistryHash,
      financial_model_hash: snapshot.financialModelHash,
      computed_metrics: computedMetrics,
      risk_flags: riskFlags,
      calculated_at: snapshot.calculatedAt,
      triggered_by: snapshot.triggeredBy ?? null,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data?.id };
}

// ---------------------------------------------------------------------------
// Load latest snapshot (for comparison)
// ---------------------------------------------------------------------------

/**
 * Load the most recent model snapshot for a deal.
 */
export async function loadLatestSnapshot(
  supabase: any,
  dealId: string,
): Promise<ModelSnapshot | null> {
  const { data, error } = await supabase
    .from("deal_model_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    dealId: data.deal_id,
    bankId: data.bank_id,
    modelVersion: data.model_version,
    metricRegistryHash: data.metric_registry_hash,
    financialModelHash: data.financial_model_hash,
    calculatedAt: data.calculated_at,
    triggeredBy: data.triggered_by ?? null,
  };
}
