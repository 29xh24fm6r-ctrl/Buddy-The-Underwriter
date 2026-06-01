import "server-only";

/**
 * SPEC-GCF-SOURCE-OF-TRUTH-AUDIT-AND-CONSOLIDATION-1
 *
 * Canonical Global Cash Flow selector — the single contract every consumer
 * should use to obtain "the" GCF value, its DSCR, and its status. The pure core
 * (resolveCanonicalGcf / resolveGcfFactValue, constants, types) lives in
 * canonicalGcfCore.ts so it can be unit-tested without the server-only barrier;
 * this module adds the DB-bound accessor.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveCanonicalGcf,
  type CanonicalGcfResult,
  type GcfFactRow,
  type GcfSpreadRow,
} from "./canonicalGcfCore";

export {
  GCF_CANONICAL_FACT_KEY,
  GCF_LEGACY_FACT_KEY,
  GCF_DSCR_FACT_KEY,
  resolveCanonicalGcf,
  resolveGcfFactValue,
} from "./canonicalGcfCore";
export type {
  CanonicalGcfState,
  CanonicalGcfResult,
  GcfFactRow,
  GcfSpreadRow,
} from "./canonicalGcfCore";

/**
 * Canonical async accessor. Loads GCF spread rows + GCF-relevant facts and
 * delegates to the pure resolver. Server-only; callers must already have
 * verified deal/bank access.
 */
export async function getCanonicalGlobalCashFlow(
  dealId: string,
  bankId: string,
): Promise<CanonicalGcfResult> {
  const sb = supabaseAdmin();

  const [{ data: spreadData }, { data: factData }] = await Promise.all([
    (sb as any)
      .from("deal_spreads")
      .select("status, owner_type, updated_at, error, error_code, error_details_json")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("spread_type", "GLOBAL_CASH_FLOW")
      .neq("error_code", "SUPERSEDED_BY_NEWER_VERSION"),
    (sb as any)
      .from("deal_financial_facts")
      .select(
        "fact_key, fact_value_num, fact_type, owner_type, owner_entity_id, fact_period_end, created_at, is_superseded",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false),
  ]);

  return resolveCanonicalGcf({
    spreadRows: (spreadData ?? []) as GcfSpreadRow[],
    factRows: (factData ?? []) as GcfFactRow[],
  });
}
