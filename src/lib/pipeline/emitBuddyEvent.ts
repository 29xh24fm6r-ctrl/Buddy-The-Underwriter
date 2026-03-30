import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Standardized pipeline event writer.
 * Extends the existing deal_pipeline_ledger with consistent event contracts.
 * Non-blocking — never throws.
 */
export type BuddyPipelineEvent = {
  eventKey: string;
  dealId: string;
  bankId: string;
  actorId?: string | null;
  stage?: string;
  status: "ok" | "warn" | "error";
  payload?: Record<string, unknown>;
  durationMs?: number;
};

export async function emitBuddyEvent(event: BuddyPipelineEvent): Promise<void> {
  try {
    const sb = supabaseAdmin();
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: event.dealId,
      bank_id: event.bankId,
      event_key: event.eventKey,
      stage: event.stage ?? event.eventKey,
      status: event.status,
      payload: {
        ...event.payload,
        actor_id: event.actorId ?? null,
        duration_ms: event.durationMs ?? null,
      },
      ui_state: event.status === "ok" ? "done" : event.status === "error" ? "error" : "waiting",
      ui_message: event.eventKey.replace(/[._]/g, " "),
      meta: {
        source: "buddy_pipeline_event",
        duration_ms: event.durationMs ?? null,
      },
    });
  } catch (err) {
    // Telemetry must never break user flows
    console.warn("[emitBuddyEvent] failed:", event.eventKey, err);
  }
}

/**
 * Structured JSON log emitter for server-side counters.
 * Non-blocking, safe to fail.
 */
export function emitStructuredLog(
  counter: string,
  data: Record<string, unknown>,
): void {
  try {
    console.log(
      JSON.stringify({
        _type: "buddy_counter",
        counter,
        ...data,
        ts: new Date().toISOString(),
      }),
    );
  } catch {
    // silent
  }
}
