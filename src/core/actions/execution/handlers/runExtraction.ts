import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecuteCanonicalActionInput, ExecuteCanonicalActionResult } from "../types";

/**
 * run_extraction — Queue extraction job for deal documents.
 * Idempotent: skips if an active extraction event exists within the last 5 minutes.
 */
export async function handleRunExtraction(
  sb: SupabaseClient,
  input: ExecuteCanonicalActionInput,
): Promise<ExecuteCanonicalActionResult> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: recent } = await sb
    .from("deal_pipeline_ledger")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("event_key", "canonical_action.run_extraction")
    .gte("created_at", fiveMinAgo)
    .in("status", ["working", "ok"])
    .maybeSingle();

  if (recent) {
    return {
      ok: true,
      actionCode: "run_extraction",
      target: "workflow",
      targetRecordId: recent.id,
      status: "already_exists",
    };
  }

  // Queue via ledger event — pipeline workers pick up extraction jobs from ledger
  const { data: evt } = await sb
    .from("deal_pipeline_ledger")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      event_key: "canonical_action.run_extraction",
      stage: "canonical_action.run_extraction",
      status: "working",
      ui_state: "working",
      ui_message: "Extraction queued via canonical action.",
      meta: { triggered_by: input.executedBy, actor_type: input.actorType },
    } as any)
    .select("id")
    .single();

  return {
    ok: true,
    actionCode: "run_extraction",
    target: "workflow",
    targetRecordId: evt?.id ?? null,
    status: "queued",
  };
}
