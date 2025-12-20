// src/lib/underwrite/docFacts.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Best-effort doc facts fetch.
 *
 * We try a few likely table shapes:
 * 1) deal_doc_facts (deal_id, facts jsonb)
 * 2) deal_facts (deal_id, facts jsonb)
 * 3) document_results (deal_id/entity_id + result_json/facts_json)
 *
 * If none exist, return empty object.
 */
export async function fetchDealDocFacts(dealId: string): Promise<Record<string, any>> {
  const sb = supabaseAdmin();

  // helper that returns {} on any failure (schema mismatch / table missing)
  async function tryTable(table: string, select: string, where: Record<string, any>) {
    try {
      let q: any = sb.from(table).select(select).limit(1);

      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);

      const { data, error } = await q;
      if (error) return null;
      if (!data || !data.length) return null;
      return data[0];
    } catch {
      return null;
    }
  }

  // 1) deal_doc_facts
  const a = await tryTable("deal_doc_facts", "facts", { deal_id: dealId });
  if (a?.facts && typeof a.facts === "object") return a.facts;

  // 2) deal_facts
  const b = await tryTable("deal_facts", "facts", { deal_id: dealId });
  if (b?.facts && typeof b.facts === "object") return b.facts;

  /**
   * 3) document_results (highly variable in your repo over time)
   * We try common shapes without assuming a fixed schema.
   */
  const c = await tryTable("document_results", "result_json, facts_json, result, facts, deal_id, entity_id", { deal_id: dealId });
  const maybe =
    (c?.facts_json ?? null) ||
    (c?.facts ?? null) ||
    (c?.result_json ?? null) ||
    (c?.result ?? null);

  if (maybe && typeof maybe === "object") return maybe;

  return {};
}
