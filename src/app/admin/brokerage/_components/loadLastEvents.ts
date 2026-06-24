import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Map deal_id → latest ai_events.action, for the given deal_ids.
 * Returns NULL action when no event exists for a deal. SPEC-BROKERAGE-
 * LAUNCH-BLOCKERS-V1 §3.6 — the drilldown tables render last action so
 * ops can decide the next triage move.
 */
export async function loadLastEvents(
  dealIds: string[],
): Promise<Map<string, string>> {
  if (dealIds.length === 0) return new Map();
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("ai_events")
    .select("deal_id, action, created_at")
    .in("deal_id", dealIds)
    .order("created_at", { ascending: false });

  const result = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ deal_id: string; action: string }>) {
    if (!result.has(row.deal_id)) {
      result.set(row.deal_id, row.action);
    }
  }
  return result;
}
