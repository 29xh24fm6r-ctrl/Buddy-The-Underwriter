import type { SupabaseClient } from "@supabase/supabase-js";

export async function logPipelineLedger(
  sb: SupabaseClient,
  row: {
    bank_id: string | null;
    deal_id: string;
    event_type: string;
    status: "ok" | "error" | "warn" | string;
    payload?: any;
    error?: string | null;
  }
) {
  await sb.from("deal_pipeline_ledger").insert({
    bank_id: row.bank_id,
    deal_id: row.deal_id,
    event_type: row.event_type,
    status: row.status,
    payload: row.payload ?? null,
    error: row.error ?? null,
  } as any);
}
