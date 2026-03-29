import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RelationshipAutonomyEventCode } from "./types";

/**
 * Append-only autonomy event logger. Fire-and-forget — never throws.
 */
export async function logRelationshipAutonomyEvent(params: {
  relationshipId: string;
  bankId: string;
  eventCode: RelationshipAutonomyEventCode;
  actorType?: string;
  actorUserId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = supabaseAdmin();
    await sb.from("relationship_autonomy_events").insert({
      relationship_id: params.relationshipId,
      bank_id: params.bankId,
      event_code: params.eventCode,
      actor_type: params.actorType ?? "system",
      actor_user_id: params.actorUserId ?? null,
      payload: params.payload ?? {},
    });
  } catch (err) {
    console.error("[logRelationshipAutonomyEvent] error:", err);
  }
}
