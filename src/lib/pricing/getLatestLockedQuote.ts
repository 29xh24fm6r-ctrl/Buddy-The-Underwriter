import type { SupabaseClient } from "@supabase/supabase-js";

export async function getLatestLockedQuoteId(
  sb: SupabaseClient,
  dealId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("deal_pricing_quotes")
    .select("id, locked_at, created_at, status")
    .eq("deal_id", dealId)
    .eq("status", "locked")
    .order("locked_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
  const row = data?.[0];
  return row?.id ?? null;
}
