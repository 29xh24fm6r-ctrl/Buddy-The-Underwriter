/**
 * Material Change Engine — Phase 66B
 *
 * Server module. Orchestrates change detection, scope classification,
 * invalidation planning, reuse planning, and event persistence.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeDealFingerprint,
  diffFingerprints,
  type DealStateSnapshot,
} from "./changeFingerprint";
import {
  planInvalidation,
  type ChangeType,
  type ChangeScope,
  type InvalidationPlan,
} from "./invalidationPlanner";
import { planReuse, type PriorComputationState, type ReusePlan } from "./reusePlanner";
import {
  scopeToMaterialityScore,
  materialChangeRowToDomain,
  type MaterialChangeDomain,
  type MaterialChangeRow,
} from "@/lib/contracts/phase66b66cRowMappers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaterialChangeInput {
  dealId: string;
  bankId: string;
  missionId?: string;
  changeType: ChangeType;
  oldState?: DealStateSnapshot;
  newState?: DealStateSnapshot;
}

export interface MaterialChangeResult {
  ok: boolean;
  changeId?: string;
  scope: ChangeScope;
  materiality: string;
  invalidationPlan: InvalidationPlan;
  reusePlan: ReusePlan;
}

export type MaterialChangeEvent = MaterialChangeDomain;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Classify the scope of a change based on the diff between old and new
 * fingerprints and the change type.
 */
function classifyScope(
  changeType: ChangeType,
  oldState?: DealStateSnapshot,
  newState?: DealStateSnapshot,
): ChangeScope {
  // If we lack state comparison data, assume material.
  if (!oldState || !newState) return "material";

  const oldFp = computeDealFingerprint(oldState);
  const newFp = computeDealFingerprint(newState);
  const { changed } = diffFingerprints(oldFp, newFp);

  if (!changed) return "trivial";

  // Financial or structural changes that alter the full fingerprint are material.
  if (
    changeType === "financial_data_updated" ||
    changeType === "structure_changed"
  ) {
    return "material";
  }

  // Entity name or benchmark changes are usually localized.
  if (
    changeType === "entity_name_changed" ||
    changeType === "benchmark_refreshed" ||
    changeType === "monitoring_signal"
  ) {
    return "localized";
  }

  // Document uploads or manual overrides: check magnitude of document delta.
  const docDelta = Math.abs(
    newState.documentIds.length - oldState.documentIds.length,
  );
  if (docDelta > 3) return "mission_wide";
  if (docDelta > 0) return "material";

  return "localized";
}

function classifyMateriality(scope: ChangeScope): string {
  return scopeToMaterialityScore(scope);
}

function buildPriorComputationState(
  oldState?: DealStateSnapshot,
): PriorComputationState {
  if (!oldState) {
    return { completedStages: [], snapshotAge: Infinity, factCount: 0 };
  }
  return {
    completedStages: [
      "extraction",
      "spreading",
      "ratios",
      "snapshot",
      "scenarios",
      "pricing",
    ],
    snapshotAge: 0, // Assume fresh when old state is provided
    factCount: oldState.factKeys.length,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a material change event: compute fingerprints, classify scope,
 * plan invalidation + reuse, and persist to `buddy_material_change_events`.
 */
export async function recordMaterialChange(
  sb: SupabaseClient,
  input: MaterialChangeInput,
): Promise<MaterialChangeResult> {
  const scope = classifyScope(input.changeType, input.oldState, input.newState);
  const materiality = classifyMateriality(scope);

  const invalidation = planInvalidation(input.changeType, scope);
  const priorState = buildPriorComputationState(input.oldState);
  const reuse = planReuse(invalidation, priorState);

  const oldFp = input.oldState
    ? computeDealFingerprint(input.oldState)
    : null;
  const newFp = input.newState
    ? computeDealFingerprint(input.newState)
    : null;

  const { data, error } = await sb
    .from("buddy_material_change_events")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      buddy_research_mission_id: input.missionId ?? null,
      change_type: input.changeType,
      change_scope: scope,
      materiality_score: materiality,
      affected_systems_json: invalidation,
      reuse_plan_json: reuse,
      old_fingerprint: oldFp,
      new_fingerprint: newFp,
    })
    .select("id")
    .single();

  if (error) {
    return {
      ok: false,
      scope,
      materiality,
      invalidationPlan: invalidation,
      reusePlan: reuse,
    };
  }

  return {
    ok: true,
    changeId: data.id,
    scope,
    materiality,
    invalidationPlan: invalidation,
    reusePlan: reuse,
  };
}

/**
 * Retrieve recent material change events for a deal.
 */
export async function getRecentChanges(
  sb: SupabaseClient,
  dealId: string,
  limit = 20,
): Promise<MaterialChangeEvent[]> {
  const { data, error } = await sb
    .from("buddy_material_change_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[materialChangeEngine] getRecentChanges failed", { dealId, error: error.message });
    return [];
  }
  if (!data) return [];
  return data.map((row: Record<string, unknown>) => materialChangeRowToDomain(row as MaterialChangeRow));
}
