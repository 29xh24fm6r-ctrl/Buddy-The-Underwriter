import "server-only";

/**
 * Phase 65G — Primary Action Age Resolution
 *
 * Tracks when the current primary action was first observed.
 * Uses deal_primary_action_history for stable aging.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Get or create the first_seen_at timestamp for the current primary action.
 * Upserts history row so age is stable across processor runs.
 */
export async function getPrimaryActionStartedAt(
  dealId: string,
  actionCode: string | null,
): Promise<string | null> {
  if (!actionCode) return null;

  const sb = supabaseAdmin();

  // Check existing current record
  const { data: existing } = await sb
    .from("deal_primary_action_history")
    .select("id, first_seen_at, action_code")
    .eq("deal_id", dealId)
    .eq("is_current", true)
    .maybeSingle();

  if (existing?.action_code === actionCode) {
    // Same action — update last_seen_at, return stable first_seen_at
    await sb
      .from("deal_primary_action_history")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.first_seen_at;
  }

  // Action changed — mark old as not current
  if (existing) {
    await sb
      .from("deal_primary_action_history")
      .update({ is_current: false })
      .eq("id", existing.id);
  }

  // Insert new current record
  const now = new Date().toISOString();
  const { data: created } = await sb
    .from("deal_primary_action_history")
    .insert({
      deal_id: dealId,
      action_code: actionCode,
      first_seen_at: now,
      last_seen_at: now,
      is_current: true,
    })
    .select("first_seen_at")
    .single();

  return created?.first_seen_at ?? now;
}
