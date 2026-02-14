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
): Promise<{ ok: boolean; id?: string; deduped?: boolean; error?: string }> {
  // Phase 12: Immutability guard — skip write if identical outputs_hash exists for deal
  if (snapshot.outputsHash) {
    const { data: existing } = await supabase
      .from("deal_model_snapshots")
      .select("id")
      .eq("deal_id", snapshot.dealId)
      .eq("outputs_hash", snapshot.outputsHash)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return { ok: true, id: existing.id, deduped: true };
    }
  }

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
      // Phase 12: registry version binding
      registry_version_id: snapshot.registryVersionId ?? null,
      registry_content_hash: snapshot.registryContentHash ?? null,
      registry_version_name: snapshot.registryVersionName ?? null,
      engine_version: snapshot.engineVersion ?? null,
      compute_trace_id: snapshot.computeTraceId ?? null,
      outputs_hash: snapshot.outputsHash ?? null,
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
    // Phase 12
    registryVersionId: data.registry_version_id ?? null,
    registryContentHash: data.registry_content_hash ?? null,
    registryVersionName: data.registry_version_name ?? null,
    engineVersion: data.engine_version ?? null,
    computeTraceId: data.compute_trace_id ?? null,
    outputsHash: data.outputs_hash ?? null,
  };
}
