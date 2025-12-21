// src/lib/intel/events.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type IntelSeverity = "info" | "warn" | "success" | "danger";

export type RecordIntelEventArgs = {
  bankId?: string | null;
  dealId?: string | null;
  fileId?: string | null;

  actorUserId?: string | null;
  actorType?: "system" | "user" | "borrower";

  eventType: string;
  severity?: IntelSeverity;

  title: string;
  message?: string | null;

  icon?: string | null;

  citationId?: string | null;
  globalCharStart?: number | null;
  globalCharEnd?: number | null;
  page?: number | null;
  overlayId?: string | null;

  meta?: Record<string, any>;
};

/**
 * Best-effort event logging. Never throw.
 */
export async function recordIntelEvent(args: RecordIntelEventArgs) {
  try {
    const sb = supabaseAdmin();

    await sb.from("buddy_intel_events").insert({
      bank_id: args.bankId ?? null,
      deal_id: args.dealId ?? null,
      file_id: args.fileId ?? null,

      actor_user_id: args.actorUserId ?? null,
      actor_type: args.actorType ?? "system",

      event_type: args.eventType,
      severity: args.severity ?? "info",

      title: args.title,
      message: args.message ?? null,

      icon: args.icon ?? null,

      citation_id: args.citationId ?? null,
      global_char_start: args.globalCharStart ?? null,
      global_char_end: args.globalCharEnd ?? null,
      page: args.page ?? null,

      meta: {
        ...(args.meta ?? {}),
        overlay_id: args.overlayId ?? (args.meta as any)?.overlay_id ?? null,
      },
    });
  } catch {
    // swallow - never break flow for logging
  }
}
