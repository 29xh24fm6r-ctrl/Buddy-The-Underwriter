/**
 * deal_events adapter - writes decision events to existing deal_events table
 * Uses existing schema: {deal_id, bank_id, kind, payload}
 * Maps new decision event format into payload JSONB
 * 
 * ⚠️ IMPORTANT: deal_events uses `payload` (jsonb)
 * There is NO `metadata` column. Do not add one.
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

type DealEventInsert = {
  deal_id: string;
  bank_id: string;
  kind: string;
  payload: Record<string, any>;
  // ⚠️ NO metadata field - use payload only
};

/**
 * Write event to existing deal_events table
 * Maps new fields (actorUserId, actorRole, title, detail) into payload JSONB
 */
export async function writeDealEvent(input: DealEventInput) {
  const sb = supabaseAdmin();

  const insertData: DealEventInsert = {
    deal_id: input.dealId,
    bank_id: input.bankId,
    kind: input.kind,
    payload: {
      description: input.title || input.kind,
      actor_user_id: input.actorUserId,
      actor_role: input.actorRole,
      detail: input.detail,
      ...input.payload,
    },
  };

  const { error } = await sb.from("deal_events").insert(insertData);

  if (error) {
    console.error("Failed to write deal event", error);
    throw error;
  }
}
