// src/lib/packs/recordMatchEvent.ts
// Record when a pack is matched/applied to a deal
// Feeds learning system and ranking

import { supabaseAdmin } from "@/lib/supabase/admin";

export type MatchEventInput = {
  bankId: string;
  dealId: string;
  packId: string;
  matchScore: number;
  autoApplied?: boolean;
  suggested?: boolean;
  manuallyApplied?: boolean;
  metadata?: Record<string, any>;
};

export async function recordMatchEvent(input: MatchEventInput): Promise<string> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("borrower_pack_match_events")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      pack_id: input.packId,
      match_score: input.matchScore,
      auto_applied: input.autoApplied || false,
      suggested: input.suggested || false,
      manually_applied: input.manuallyApplied || false,
      metadata: input.metadata || {},
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to record match event: ${error.message}`);
  if (!data?.id) throw new Error("No match event ID returned");

  return data.id;
}
