import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecuteCanonicalActionInput, ExecuteCanonicalActionResult } from "../types";

/**
 * seed_checklist — Initialize deal workflow checklist.
 * Idempotent: skips if a checklist seed already exists for this deal.
 */
export async function handleSeedChecklist(
  sb: SupabaseClient,
  input: ExecuteCanonicalActionInput,
): Promise<ExecuteCanonicalActionResult> {
  const { data: existing } = await sb
    .from("deal_monitoring_seeds")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("type", "checklist_seed")
    .in("status", ["seeded", "activated"])
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      actionCode: "seed_checklist",
      target: "workflow",
      targetRecordId: existing.id,
      status: "already_exists",
    };
  }

  const { data: seed } = await sb
    .from("deal_monitoring_seeds")
    .insert({
      deal_id: input.dealId,
      type: "checklist_seed",
      description: "Deal checklist initialized via canonical action.",
      source_action_id: null,
      status: "seeded",
    })
    .select("id")
    .single();

  return {
    ok: true,
    actionCode: "seed_checklist",
    target: "workflow",
    targetRecordId: seed?.id ?? null,
    status: "created",
  };
}
