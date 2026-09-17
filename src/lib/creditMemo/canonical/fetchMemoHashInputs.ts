import "server-only";
// v2 — corrected table/column names (deal_financial_snapshots→financial_snapshots, pricing_decisions.updated_at→decided_at)

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
  fundingInputs?: unknown;
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
 * Column corrections (verified against DB schema):
 * - financial_snapshots (not deal_financial_snapshots — that table does not exist)
 * - financial_snapshots.created_at (no updated_at column)
 * - pricing_decisions.decided_at (not updated_at — that column does not exist)
 */
export async function fetchMemoHashInputs(
  sb: SupabaseClient,
  dealId: string,
): Promise<MemoHashInputs> {
  const [snapshotRes, pricingRes, factsRes, assumptionsRes, proceedsRes] = await Promise.all([
    // financial_snapshots is the correct table (deal_financial_snapshots does not exist)
    // ordered by created_at (no updated_at column)
    sb.from("financial_snapshots")
      .select("id, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // pricing_decisions.decided_at is the correct column (updated_at does not exist)
    sb.from("pricing_decisions")
      .select("id, decided_at")
      .eq("deal_id", dealId)
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    sb.from("deal_financial_facts")
      .select("id, created_at")
      .eq("deal_id", dealId)
      .not("fact_value_num", "is", null)
      .order("created_at", { ascending: false }),
    sb.from("buddy_sba_assumptions").select("status,confirmed_at,loan_impact,management_team").eq("deal_id", dealId).maybeSingle(),
    sb.from("deal_proceeds_items").select("id,category,description,amount").eq("deal_id", dealId).order("id"),
  ]);
  for (const result of [snapshotRes, pricingRes, factsRes, assumptionsRes, proceedsRes]) {
    if (result.error) throw new Error(`Memo input load failed: ${result.error.message}`);
  }

  const facts = factsRes.data ?? [];

  return {
    fundingInputs: { assumptions: assumptionsRes.data ?? null, proceeds: proceedsRes.data ?? [] },
    snapshotId: snapshotRes.data?.id ?? null,
    snapshotUpdatedAt: snapshotRes.data?.created_at ?? null,
    pricingDecisionId: pricingRes.data?.id ?? null,
    pricingUpdatedAt: pricingRes.data?.decided_at ?? null,
    factCount: facts.length,
    latestFactUpdatedAt: facts.length > 0 ? (facts[0] as any).created_at ?? null : null,
  };
}
