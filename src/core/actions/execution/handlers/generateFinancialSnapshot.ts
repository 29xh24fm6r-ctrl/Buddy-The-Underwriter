import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecuteCanonicalActionInput, ExecuteCanonicalActionResult } from "../types";

/**
 * generate_financial_snapshot — Queue snapshot generation.
 * Idempotent: skips if a recent snapshot generation is already in-flight.
 */
export async function handleGenerateFinancialSnapshot(
  sb: SupabaseClient,
  input: ExecuteCanonicalActionInput,
): Promise<ExecuteCanonicalActionResult> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: recent } = await sb
    .from("deal_pipeline_ledger")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("event_key", "canonical_action.generate_financial_snapshot")
    .gte("created_at", fiveMinAgo)
    .in("status", ["working", "ok"])
    .maybeSingle();

  if (recent) {
    return {
      ok: true,
      actionCode: "generate_financial_snapshot",
      target: "financial_snapshot",
      targetRecordId: recent.id,
      status: "already_exists",
    };
  }

  const { data: evt } = await sb
    .from("deal_pipeline_ledger")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      event_key: "canonical_action.generate_financial_snapshot",
      stage: "canonical_action.generate_financial_snapshot",
      status: "working",
      ui_state: "working",
      ui_message: "Financial snapshot generation queued via canonical action.",
      meta: { triggered_by: input.executedBy, actor_type: input.actorType },
    } as any)
    .select("id")
    .single();

  return {
    ok: true,
    actionCode: "generate_financial_snapshot",
    target: "financial_snapshot",
    targetRecordId: evt?.id ?? null,
    status: "queued",
  };
}
