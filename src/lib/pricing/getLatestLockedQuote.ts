import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a non-null ID if the deal has a valid pricing decision.
 *
 * Checks BOTH sources of truth:
 * 1. pricing_decisions (institutional decision system — authoritative)
 * 2. deal_pricing_quotes with status=locked (legacy calculator — fallback)
 *
 * If either exists, the deal is considered "priced".
 */
export async function getLatestLockedQuoteId(
  sb: SupabaseClient,
  dealId: string,
): Promise<string | null> {
  // Check authoritative pricing_decisions first
  const { data: decision, error: decErr } = await sb
    .from("pricing_decisions")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!decErr && decision?.id) return decision.id;

  // Fallback: legacy locked quote
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
