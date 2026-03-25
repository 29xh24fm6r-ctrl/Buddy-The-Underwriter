/**
 * Structure freeze — captures immutable snapshot for committee.
 * Does NOT block builder edits. Only one active freeze per deal.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type StructuringFreezeRow = {
  id: string;
  deal_id: string;
  frozen_selection_id: string;
  frozen_builder_state_json: Record<string, unknown>;
  frozen_policy_exceptions_json: unknown[];
  frozen_decisions_json: unknown[];
  frozen_memo_snapshot_id: string | null;
  frozen_by: string | null;
  frozen_at: string;
  is_active: boolean;
};

export type FreezeInput = {
  dealId: string;
  selectionId: string;
  builderState: Record<string, unknown>;
  policyExceptions: unknown[];
  decisions: unknown[];
  memoSnapshotId?: string | null;
  frozenBy: string;
};

/**
 * Freeze the current structure for committee review.
 * Deactivates any previous active freeze.
 */
export async function freezeStructure(
  sb: SupabaseClient,
  input: FreezeInput,
): Promise<string | null> {
  // Deactivate previous
  await sb
    .from("deal_structuring_freeze")
    .update({ is_active: false })
    .eq("deal_id", input.dealId)
    .eq("is_active", true);

  // Insert new freeze
  const { data, error } = await sb
    .from("deal_structuring_freeze")
    .insert({
      deal_id: input.dealId,
      frozen_selection_id: input.selectionId,
      frozen_builder_state_json: input.builderState,
      frozen_policy_exceptions_json: input.policyExceptions,
      frozen_decisions_json: input.decisions,
      frozen_memo_snapshot_id: input.memoSnapshotId ?? null,
      frozen_by: input.frozenBy,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[structuringFreeze] freeze failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Load the active freeze for a deal.
 */
export async function loadActiveFreeze(
  sb: SupabaseClient,
  dealId: string,
): Promise<StructuringFreezeRow | null> {
  const { data, error } = await sb
    .from("deal_structuring_freeze")
    .select("*")
    .eq("deal_id", dealId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  return data as StructuringFreezeRow;
}
