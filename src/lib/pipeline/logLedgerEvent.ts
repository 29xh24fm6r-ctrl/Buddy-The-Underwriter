import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

interface ProviderMetrics {
  provider: string;
  route?: string;
  processorType?: string;
  model?: string;
  pages?: number;
  unit_count?: number;
  estimated_cost_usd?: number;
}

interface LogLedgerEventInput {
  dealId: string;
  bankId: string;
  eventKey: string;
  uiState: "working" | "done" | "waiting" | "error";
  uiMessage: string;
  meta?: Record<string, unknown>;
  provider_metrics?: ProviderMetrics;
}

export async function logLedgerEvent(input: LogLedgerEventInput) {
  const sb = supabaseAdmin();

  // Ledger writes should never block business logic.
  try {
    // Extract provider_metrics from meta if present (for backwards compat)
    const providerMetrics =
      input.provider_metrics ??
      (input.meta?.provider_metrics as ProviderMetrics | undefined);

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
            : input.uiState === "error"
              ? "error"
              : "waiting",
      ui_state: input.uiState,
      ui_message: input.uiMessage,
      meta: input.meta ?? {},
      provider_metrics: providerMetrics ?? null,
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
