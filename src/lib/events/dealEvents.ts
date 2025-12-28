/**
 * deal_events adapter - writes decision events to existing deal_events table
 * Uses existing schema: {deal_id, bank_id, kind, description, metadata}
 * Maps new decision event format into existing columns via metadata JSONB
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface DealEventInput {
  dealId: string;
  bankId: string;
  kind: string;
  actorUserId?: string;
  actorRole?: string;
  title?: string;
  detail?: string;
  payload?: Record<string, any>;
}

/**
 * Write event to existing deal_events table
 * Maps new fields (actorUserId, actorRole, title, detail) into metadata payload
 */
export async function writeDealEvent(input: DealEventInput) {
  const sb = supabaseAdmin();

  const { error } = await sb.from("deal_events").insert({
    deal_id: input.dealId,
    bank_id: input.bankId,
    kind: input.kind,
    description: input.title || input.kind,
    metadata: {
      actor_user_id: input.actorUserId,
      actor_role: input.actorRole,
      detail: input.detail,
      ...input.payload,
    },
  });

  if (error) {
    console.error("Failed to write deal event", error);
    throw error;
  }
}
