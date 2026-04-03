import "server-only";

/**
 * Canonical memo hash input assembly.
 *
 * Single source of truth for the inputs to `computeMemoInputHash()`.
 * Both the memo generation route and the trust layer builder must use
 * this function to avoid hash divergence.
 *
 * Returns the exact arguments needed for `computeMemoInputHash()`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoHashInputs = {
  snapshotId: string | null;
  snapshotUpdatedAt: string | null;
  pricingDecisionId: string | null;
  pricingUpdatedAt: string | null;
  factCount: number;
  latestFactUpdatedAt: string | null;
};

/**
 * Fetch canonical memo hash inputs from the database.
 *
 * Uses the same queries and semantics as the memo generation route:
 * - snapshot from `deal_financial_snapshots` (latest by updated_at)
 * - pricing decision from `pricing_decisions` (latest by updated_at)
 * - facts from `deal_financial_facts` (count of non-null numeric facts, latest created_at)
 */
export async function fetchMemoHashInputs(
  sb: SupabaseClient,
  dealId: string,
): Promise<MemoHashInputs> {
  const [snapshotRes, pricingRes, factsRes] = await Promise.all([
    sb.from("deal_financial_snapshots")
      .select("id, updated_at")
      .eq("deal_id", dealId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    sb.from("pricing_decisions")
      .select("id, updated_at")
      .eq("deal_id", dealId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    sb.from("deal_financial_facts")
      .select("id, created_at")
      .eq("deal_id", dealId)
      .not("fact_value_num", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const facts = factsRes.data ?? [];

  return {
    snapshotId: snapshotRes.data?.id ?? null,
    snapshotUpdatedAt: snapshotRes.data?.updated_at ?? null,
    pricingDecisionId: pricingRes.data?.id ?? null,
    pricingUpdatedAt: pricingRes.data?.updated_at ?? null,
    factCount: facts.length,
    latestFactUpdatedAt: facts.length > 0 ? (facts[0] as any).created_at ?? null : null,
  };
}
