import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

interface LogLedgerEventInput {
  dealId: string;
  bankId: string;
  eventKey: string;
  uiState: "working" | "done" | "waiting";
  uiMessage: string;
  meta?: Record<string, unknown>;
}

export async function logLedgerEvent(input: LogLedgerEventInput) {
  const sb = supabaseAdmin();

  await sb.from("deal_pipeline_ledger").insert({
    deal_id: input.dealId,
    bank_id: input.bankId,
    event_key: input.eventKey,
    ui_state: input.uiState,
    ui_message: input.uiMessage,
    meta: input.meta ?? {},
  });
}
