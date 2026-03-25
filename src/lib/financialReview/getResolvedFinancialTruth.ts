import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRUSTED_RESOLUTION_FILTER } from "./isTrustedFinancialResolution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolvedFinancialTruth = {
  factKey: string;
  value: number | null;
  source: "override" | "provided" | "confirmed";
  factId: string | null;
  resolutionStatus: string;
  periodStart: string | null;
  periodEnd: string | null;
};

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Returns the best trusted resolved value for each requested fact_key.
 *
 * Priority order (enforced by query sort):
 *   1. overridden  (banker replaced value)
 *   2. provided    (banker entered missing value)
 *   3. confirmed   (banker accepted extracted value / selected source)
 *
 * Only returns facts with trusted resolution status.
 * Superseded facts are excluded.
 *
 * Use this for snapshot assembly, pricing, credit memo, and any downstream
 * consumer that needs banker-resolved truth.
 */
export async function getResolvedFinancialTruth(args: {
  dealId: string;
  bankId: string;
  factKeys: string[];
}): Promise<Map<string, ResolvedFinancialTruth>> {
  if (args.factKeys.length === 0) return new Map();

  const sb = supabaseAdmin();

  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("id, fact_key, fact_value_num, resolution_status, fact_period_start, fact_period_end")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("is_superseded", false)
    .in("resolution_status", TRUSTED_RESOLUTION_FILTER)
    .in("fact_key", args.factKeys)
    .not("fact_value_num", "is", null)
    .order("created_at", { ascending: false });

  const result = new Map<string, ResolvedFinancialTruth>();

  // Priority: overridden > provided > confirmed
  // Since we sort by created_at desc, we process all and keep highest priority per key
  const priorityMap: Record<string, number> = {
    overridden: 0,
    provided: 1,
    confirmed: 2,
  };

  for (const f of facts ?? []) {
    const existing = result.get(f.fact_key);
    const currentPriority = priorityMap[f.resolution_status] ?? 9;
    const existingPriority = existing ? (priorityMap[existing.resolutionStatus] ?? 9) : 99;

    if (currentPriority < existingPriority) {
      const source: ResolvedFinancialTruth["source"] =
        f.resolution_status === "overridden" ? "override" :
        f.resolution_status === "provided" ? "provided" :
        "confirmed";

      result.set(f.fact_key, {
        factKey: f.fact_key,
        value: f.fact_value_num,
        source,
        factId: f.id,
        resolutionStatus: f.resolution_status,
        periodStart: f.fact_period_start,
        periodEnd: f.fact_period_end,
      });
    }
  }

  return result;
}
