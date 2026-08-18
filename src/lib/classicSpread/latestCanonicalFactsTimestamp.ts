type SupabaseLike = { from: (table: string) => any };

/**
 * The financial-facts ledger is append/version based and exposes created_at,
 * not updated_at. Keep every Classic Spread staleness boundary on this one
 * schema-correct reader so worker and HTTP paths cannot drift again.
 */
export async function loadLatestCanonicalFactsTimestamp(
  sb: SupabaseLike,
  dealId: string,
  bankId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("deal_financial_facts")
    .select("created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.created_at ?? null;
}
