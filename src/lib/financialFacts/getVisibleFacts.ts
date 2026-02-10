import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Canonical facts visibility query — single source of truth.
 *
 * Used by: snapshot recompute, spreads status, readiness checks.
 * Scope: deal_id + bank_id (no owner_type filter — all owners are visible).
 */

export type FactsVisibility = {
  total: number;
  byOwnerType: Record<string, number>;
  byFactType: Record<string, number>;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
};

export async function getVisibleFacts(
  dealId: string,
  bankId: string,
): Promise<FactsVisibility> {
  const sb = supabaseAdmin();

  const { data, error } = await (sb as any)
    .from("deal_financial_facts")
    .select("id, owner_type, fact_type, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .neq("fact_type", "EXTRACTION_HEARTBEAT");

  if (error || !data) {
    return {
      total: 0,
      byOwnerType: {},
      byFactType: {},
      oldestCreatedAt: null,
      newestCreatedAt: null,
    };
  }

  const rows = data as Array<{
    id: string;
    owner_type: string;
    fact_type: string;
    created_at: string;
  }>;

  const byOwnerType: Record<string, number> = {};
  const byFactType: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const r of rows) {
    byOwnerType[r.owner_type] = (byOwnerType[r.owner_type] ?? 0) + 1;
    byFactType[r.fact_type] = (byFactType[r.fact_type] ?? 0) + 1;
    if (!oldest || r.created_at < oldest) oldest = r.created_at;
    if (!newest || r.created_at > newest) newest = r.created_at;
  }

  return {
    total: rows.length,
    byOwnerType,
    byFactType,
    oldestCreatedAt: oldest,
    newestCreatedAt: newest,
  };
}

/**
 * Lightweight count-only check — for guards that just need a boolean.
 */
export async function countVisibleFacts(
  dealId: string,
  bankId: string,
): Promise<number> {
  const sb = supabaseAdmin();

  const { count, error } = await (sb as any)
    .from("deal_financial_facts")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .neq("fact_type", "EXTRACTION_HEARTBEAT");

  if (error) return 0;
  return count ?? 0;
}
