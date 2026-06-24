/**
 * SPEC-T12-OPTIONAL-NEVER-PRIMARY-1 — server gate for default recompute.
 *
 * A DEFAULT recompute (no explicit per-type request) must NOT enqueue the
 * optional T12 spread unless the deal actually supplied a real T12 / monthly
 * operating-statement source. This is the server-side counterpart to the pure
 * `filterOptionalSpreadsForDefaultRecompute` rule in t12Eligibility.ts.
 *
 * "Real T12 source" = the deal is flagged `has_monthly_statements` (set by the
 * document classifier or a banker override when 12 months of monthly operating
 * statements are confirmed present) OR an active T12-classified document exists.
 *
 * No schema change: reads existing columns only.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function dealHasT12Source(dealId: string): Promise<boolean> {
  const sb = supabaseAdmin();

  const { data: deal } = await (sb as any)
    .from("deals")
    .select("has_monthly_statements")
    .eq("id", dealId)
    .maybeSingle();
  if (deal?.has_monthly_statements === true) return true;

  const { data: docs } = await (sb as any)
    .from("deal_documents")
    .select("id")
    .eq("deal_id", dealId)
    .eq("canonical_type", "T12")
    .eq("is_active", true)
    .limit(1);
  return Array.isArray(docs) && docs.length > 0;
}
