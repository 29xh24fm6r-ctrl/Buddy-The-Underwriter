// Server-only writer for fact conflict resolution.
//
// Status transitions:
//   open → acknowledged | resolved | ignored
//   acknowledged → resolved | ignored
// Resolved/ignored are terminal. The banker provides a rationale; once
// recorded the row carries the resolved value forward into the snapshot.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { scheduleReadinessRefresh } from "@/lib/deals/readiness/refreshDealReadiness";
import type { DealFactConflict, FactConflictStatus } from "./types";

export type ResolveFactConflictArgs = {
  dealId: string;
  conflictId: string;
  bankerId: string;
  newStatus: Exclude<FactConflictStatus, "open">;
  resolution?: string;
  resolvedValue?: unknown;
};

export async function resolveFactConflict(
  args: ResolveFactConflictArgs,
): Promise<
  | { ok: true; conflict: DealFactConflict }
  | { ok: false; reason: "tenant_mismatch" | "not_found" | "persist_failed"; error?: string }
> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;
  const sb = supabaseAdmin();

  const { data: existing } = await (sb as any)
    .from("deal_fact_conflicts")
    .select("id, deal_id, bank_id")
    .eq("id", args.conflictId)
    .maybeSingle();
  if (
    !existing ||
    (existing as any).deal_id !== args.dealId ||
    (existing as any).bank_id !== bankId
  ) {
    return { ok: false, reason: "not_found" };
  }

  const now = new Date().toISOString();
  const { data, error } = await (sb as any)
    .from("deal_fact_conflicts")
    .update({
      status: args.newStatus,
      resolution: args.resolution ?? null,
      resolved_value: args.resolvedValue ?? null,
      resolved_by: args.bankerId,
      resolved_at: now,
      updated_at: now,
    })
    .eq("id", args.conflictId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, reason: "persist_failed", error: error?.message };
  }
  scheduleReadinessRefresh({
    dealId: args.dealId,
    trigger: "conflict_resolved",
    actorId: args.bankerId,
  });
  return { ok: true, conflict: data as DealFactConflict };
}
