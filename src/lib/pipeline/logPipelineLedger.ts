import type { SupabaseClient } from "@supabase/supabase-js";

export async function logPipelineLedger(
  sb: SupabaseClient,
  row: {
    bank_id: string | null;
    deal_id: string;
    event_key: string;
    status: "ok" | "error" | "warn" | string;
    payload?: any;
    error?: string | null;
  }
) {
  await sb.from("deal_pipeline_ledger").insert({
    bank_id: row.bank_id,
    deal_id: row.deal_id,
    event_key: row.event_key,
    stage: row.event_key,
    status: row.status,
    payload: row.payload ?? null,
    error: row.error ?? null,
  } as any);
}
