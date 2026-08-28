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

export type LogLedgerEventResult =
  | { ok: true }
  | { ok: false; error: string };

async function persistLedgerEvent(
  input: LogLedgerEventInput,
): Promise<LogLedgerEventResult> {
  const sb = supabaseAdmin();

  // Most callers treat this ledger as best-effort. Returning an explicit result
  // lets truth-critical callers require durable evidence without changing the
  // behavior of existing fire-and-forget call sites.
  try {
    const providerMetrics =
      input.provider_metrics ??
      (input.meta?.provider_metrics as ProviderMetrics | undefined);

    const { error } = await sb.from("deal_pipeline_ledger").insert({
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

    if (error) {
      console.warn("[logLedgerEvent] insert failed (non-fatal)", {
        dealId: input.dealId,
        bankId: input.bankId,
        eventKey: input.eventKey,
        uiState: input.uiState,
        error: String(error.message ?? error),
      });
      return { ok: false, error: String(error.message ?? error) };
    }

    return { ok: true };
  } catch (e) {
    const error = String((e as any)?.message ?? e);
    console.warn("[logLedgerEvent] insert failed (non-fatal)", {
      dealId: input.dealId,
      bankId: input.bankId,
      eventKey: input.eventKey,
      uiState: input.uiState,
      error,
    });
    return { ok: false, error };
  }
}

export async function logLedgerEvent(input: LogLedgerEventInput): Promise<void> {
  await persistLedgerEvent(input);
}

export async function logLedgerEventRequired(
  input: LogLedgerEventInput,
): Promise<LogLedgerEventResult> {
  return persistLedgerEvent(input);
}
