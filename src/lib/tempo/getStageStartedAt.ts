import "server-only";

/**
 * Phase 65G — Stage Start Timestamp Resolution
 *
 * Resolves when a deal entered its current lifecycle stage.
 * Priority: lifecycle advancement event > deal updated_at fallback.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getStageStartedAt(
  dealId: string,
  currentStage: string,
): Promise<string | null> {
  const sb = supabaseAdmin();

  // 1. Check deal_events for lifecycle advancement into current stage
  const { data: evt } = await sb
    .from("deal_events")
    .select("created_at")
    .eq("deal_id", dealId)
    .in("kind", ["deal.lifecycle.advanced", "deal.lifecycle_advanced"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (evt?.created_at) return evt.created_at;

  // 2. Check deal_pipeline_ledger for stage entry
  const { data: ledger } = await sb
    .from("deal_pipeline_ledger")
    .select("created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ledger?.created_at) return ledger.created_at;

  // 3. Fallback to deal updated_at
  const { data: deal } = await sb
    .from("deals")
    .select("updated_at, created_at")
    .eq("id", dealId)
    .single();

  return deal?.updated_at ?? deal?.created_at ?? null;
}
