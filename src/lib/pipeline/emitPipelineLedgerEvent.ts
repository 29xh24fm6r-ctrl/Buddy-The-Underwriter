/**
 * Deal-scoped timeline / cockpit UX ledger writer.
 * Writes to deal_pipeline_ledger.
 *
 * NOT the canonical global observability ledger.
 * For global observability, use: src/lib/observability/emitEvent.ts → buddy_ledger_events
 *
 * Authority split:
 *   buddy_ledger_events     = canonical immutable global observability ledger
 *   deal_pipeline_ledger    = deal-scoped timeline and cockpit UX progression ledger
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type PipelineLedgerEvent = {
  eventKey: string;
  dealId: string;
  bankId: string;
  actorId?: string | null;
  stage?: string;
  status: "ok" | "warn" | "error";
  payload?: Record<string, unknown>;
  durationMs?: number;
};

/**
 * Write a deal-scoped pipeline event to deal_pipeline_ledger.
 * Non-blocking — never throws.
 */
export async function emitPipelineLedgerEvent(event: PipelineLedgerEvent): Promise<void> {
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
        source: "pipeline_ledger_event",
        duration_ms: event.durationMs ?? null,
      },
    });
  } catch (err) {
    console.warn("[emitPipelineLedgerEvent] failed:", event.eventKey, err);
  }
}

/**
 * Structured JSON log emitter for server-side counters.
 * Supplemental — not the canonical ledger. Not ledger truth.
 * Use for log-drain/metrics aggregation only.
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
