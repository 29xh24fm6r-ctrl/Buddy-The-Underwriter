// src/lib/packs/recordLearningEvent.ts
// Append-only learning events
// Never overwrites, always teaches

import { supabaseAdmin } from "@/lib/supabase/admin";

export type LearningEventType =
  | "upload_matched"
  | "upload_missed"
  | "requirement_cleared"
  | "sla_breached"
  | "override"
  | "completion"
  | "auto_applied"
  | "banker_attached";

export type LearningEventInput = {
  bankId: string;
  matchEventId: string;
  eventType: LearningEventType;
  metadata: Record<string, any>;
};

export async function recordLearningEvent(arg1: any, arg2?: LearningEventInput): Promise<void> {
  const sb = arg2 ? arg1 : null;
  const input = (arg2 ? arg2 : arg1) as LearningEventInput;

  const { error } = await sb
    .from("borrower_pack_learning_events")
    .insert({
      bank_id: input.bankId,
      match_event_id: input.matchEventId,
      event_type: input.eventType,
      metadata: input.metadata,
    });

  if (error) {
    console.error("Failed to record learning event:", error);
    // Non-blocking - don't throw, just log
  }
}
