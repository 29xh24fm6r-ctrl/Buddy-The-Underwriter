import "server-only";

/**
 * Phase 65H — Determine if a deal has changed since the banker last viewed it.
 *
 * Rules:
 * - true if new borrower activity after last acknowledgement/view
 * - true if primary action changed
 * - true if urgency bucket increased
 * - true if auto-advance occurred
 * - false otherwise
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getChangedSinceViewed(
  dealId: string,
  userId: string,
): Promise<boolean> {
  const sb = supabaseAdmin();

  // Get latest acknowledgement for this deal by this user
  const { data: lastAck } = await sb
    .from("banker_queue_acknowledgements")
    .select("acknowledged_at")
    .eq("deal_id", dealId)
    .eq("user_id", userId)
    .order("acknowledged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // If never acknowledged, check if deal has any recent activity (last 24h)
  const cutoff = lastAck?.acknowledged_at
    ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count } = await sb
    .from("deal_timeline_events")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .gt("created_at", cutoff);

  return (count ?? 0) > 0;
}
