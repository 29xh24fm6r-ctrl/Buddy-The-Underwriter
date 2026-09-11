import "server-only";
import type { supabaseAdmin } from "@/lib/supabase/admin";

/** Read the same complete input set for snapshot construction and freshness checks. */
export async function loadSnapshotFactInputs(
  client: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId?: string,
): Promise<Record<string, unknown>[]> {
  const facts: Record<string, unknown>[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from("deal_financial_facts").select("*").eq("deal_id", dealId);
    if (bankId) query = query.eq("bank_id", bankId);
    const { data, error } = await query.order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`snapshot evidence query failed: ${error.message}`);
    facts.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return facts;
  }
}
