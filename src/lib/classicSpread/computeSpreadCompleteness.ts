/**
 * Spread Completeness Score — Phase 79
 *
 * Computes what percentage of 12 critical financial fact keys are populated
 * in deal_financial_facts for a deal (any period, any non-null value).
 *
 * Used by:
 *   - Pipeline Step 1: completeness badge
 *   - Voice dispatch: auto-complete trigger (God Tier #67)
 *
 * Pure read — never writes to DB. Never throws — returns null on error.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const CRITICAL_SPREAD_KEYS = [
  // Income Statement
  "GROSS_RECEIPTS",
  "NET_INCOME",
  "DEPRECIATION",
  "INTEREST_EXPENSE",
  "COST_OF_GOODS_SOLD",
  // Balance Sheet
  "SL_TOTAL_ASSETS",
  "SL_CASH",
  "SL_AR_GROSS",
  // Structural / Derived
  "ADS",
  "DSCR",
  "EBITDA",
  "NET_WORTH",
] as const;

const FALLBACKS: Record<string, string[]> = {
  GROSS_RECEIPTS: ["TOTAL_REVENUE", "TOTAL_INCOME"],
  NET_INCOME:     ["ORDINARY_BUSINESS_INCOME"],
  ADS:            ["ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED"],
  DSCR:           ["GCF_DSCR"],
  NET_WORTH:      ["SL_TOTAL_EQUITY", "SL_RETAINED_EARNINGS"],
};

export type SpreadCompletenessResult = {
  score: number;       // 0–100
  populated: number;
  total: number;
  missing: string[];   // primary key names that are absent
  isGodTier: boolean;  // score >= 80
};

export async function computeSpreadCompleteness(
  dealId: string,
): Promise<SpreadCompletenessResult | null> {
  try {
    const sb = supabaseAdmin();

    const allKeys = [...new Set(
      CRITICAL_SPREAD_KEYS.flatMap((k) => [k, ...(FALLBACKS[k] ?? [])]),
    )];

    const { data: facts, error } = await sb
      .from("deal_financial_facts")
      .select("fact_key")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .not("fact_value_num", "is", null)
      .in("fact_key", allKeys);

    if (error) {
      console.error("[computeSpreadCompleteness] query failed:", error.message);
      return null;
    }

    const present = new Set((facts ?? []).map((f) => f.fact_key));
    const missing: string[] = [];
    let populated = 0;

    for (const key of CRITICAL_SPREAD_KEYS) {
      const toCheck = [key, ...(FALLBACKS[key] ?? [])];
      if (toCheck.some((k) => present.has(k))) {
        populated++;
      } else {
        missing.push(key);
      }
    }

    const total = CRITICAL_SPREAD_KEYS.length;
    const score = Math.round((populated / total) * 100);
    return { score, populated, total, missing, isGodTier: score >= 80 };
  } catch (err) {
    console.error("[computeSpreadCompleteness] exception:", err);
    return null;
  }
}
