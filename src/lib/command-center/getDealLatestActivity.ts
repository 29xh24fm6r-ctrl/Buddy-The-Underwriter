import "server-only";

/**
 * Phase 65H — Get latest activity timestamp for a deal.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getDealLatestActivity(
  dealId: string,
): Promise<string | null> {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deal_timeline_events")
    .select("created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.created_at ?? null;
}
