/**
 * Structuring scenario selection — decision of record.
 * Only one active selection per deal at a time.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuringScenario } from "@/lib/structuring/types";

export type StructuringSelectionRow = {
  id: string;
  deal_id: string;
  scenario_id: string;
  scenario_snapshot_json: StructuringScenario;
  selected_by: string | null;
  selected_at: string;
  is_active: boolean;
};

/**
 * Select a structuring scenario as the decision of record.
 * Deactivates any previous active selection.
 */
export async function selectStructuringScenario(
  sb: SupabaseClient,
  dealId: string,
  scenario: StructuringScenario,
  selectedBy: string,
): Promise<string | null> {
  // Deactivate previous
  await sb
    .from("deal_structuring_selections")
    .update({ is_active: false })
    .eq("deal_id", dealId)
    .eq("is_active", true);

  // Insert new
  const { data, error } = await sb
    .from("deal_structuring_selections")
    .insert({
      deal_id: dealId,
      scenario_id: scenario.id,
      scenario_snapshot_json: scenario,
      selected_by: selectedBy,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[structuringSelection] select failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Load the active selection for a deal.
 */
export async function loadActiveSelection(
  sb: SupabaseClient,
  dealId: string,
): Promise<StructuringSelectionRow | null> {
  const { data, error } = await sb
    .from("deal_structuring_selections")
    .select("*")
    .eq("deal_id", dealId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  return data as StructuringSelectionRow;
}
