import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AegisSystemEvent } from "./types";

const MAX_PAYLOAD_BYTES = 8_000;

function clampPayload(
  p: Record<string, unknown>,
): Record<string, unknown> {
  const s = JSON.stringify(p);
  if (s.length <= MAX_PAYLOAD_BYTES) return p;
  return { truncated: true, original_bytes: s.length };
}

function getEnv(): string {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return process.env.NODE_ENV ?? "development";
}

function getRelease(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
}

/**
 * Write a system event to buddy_system_events.
 *
 * Fire-and-forget: never throws, never blocks business logic.
 */
export async function writeSystemEvent(
  event: AegisSystemEvent,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("buddy_system_events" as any)
      .insert({
        event_type: event.event_type,
        severity: event.severity,
        error_signature: event.error_signature ?? null,
        source_system: event.source_system,
        source_job_id: event.source_job_id ?? null,
        source_job_table: event.source_job_table ?? null,
        deal_id: event.deal_id ?? null,
        bank_id: event.bank_id ?? null,
        error_class: event.error_class ?? null,
        error_code: event.error_code ?? null,
        error_message: event.error_message ?? null,
        error_stack: event.error_stack ?? null,
        resolution_status: event.resolution_status ?? "open",
        resolved_at: event.resolved_at ?? null,
        resolved_by: event.resolved_by ?? null,
        resolution_note: event.resolution_note ?? null,
        retry_attempt: event.retry_attempt ?? null,
        max_retries: event.max_retries ?? null,
        next_retry_at: event.next_retry_at ?? null,
        trace_id: event.trace_id ?? null,
        correlation_id: event.correlation_id ?? null,
        payload: clampPayload(event.payload ?? {}),
        env: getEnv(),
        release: getRelease(),
      } as any)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[aegis.writeSystemEvent] insert failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: (data as any)?.id };
  } catch (err: any) {
    console.error("[aegis.writeSystemEvent] exception:", err?.message);
    return { ok: false, error: err?.message };
  }
}
