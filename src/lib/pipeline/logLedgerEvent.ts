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

  // Ledger writes should never block business logic.
  try {
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      event_key: input.eventKey,
      stage: input.eventKey,
      status:
        input.uiState === "done"
          ? "ok"
          : input.uiState === "working"
            ? "working"
            : "waiting",
      ui_state: input.uiState,
      ui_message: input.uiMessage,
      meta: input.meta ?? {},
    } as any);
  } catch (e) {
    console.warn("[logLedgerEvent] insert failed (non-fatal)", {
      dealId: input.dealId,
      bankId: input.bankId,
      eventKey: input.eventKey,
      uiState: input.uiState,
      error: String((e as any)?.message ?? e),
    });
  }
}
