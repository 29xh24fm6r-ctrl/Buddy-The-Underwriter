import "server-only";

/**
 * Phase 65I — Complete Monitoring Cycle
 *
 * Banker-confirmed completion. Not auto-complete from borrower submission.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type CompleteCycleInput = {
  cycleId: string;
  dealId: string;
  reviewedBy: string;
};

export type CompleteCycleResult = {
  ok: boolean;
  error?: string;
};

export async function completeMonitoringCycle(
  input: CompleteCycleInput,
): Promise<CompleteCycleResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: cycle } = await sb
    .from("deal_monitoring_cycles")
    .select("id, status, deal_id, obligation_id")
    .eq("id", input.cycleId)
    .single();

  if (!cycle) {
    return { ok: false, error: "Cycle not found" };
  }

  // Only complete from under_review (or submitted if skipping review start)
  if (!["under_review", "submitted"].includes(cycle.status)) {
    return { ok: false, error: `Cannot complete cycle in status: ${cycle.status}` };
  }

  const { error } = await sb
    .from("deal_monitoring_cycles")
    .update({
      status: "completed",
      reviewed_at: now,
      completed_at: now,
    })
    .eq("id", input.cycleId);

  if (error) {
    return { ok: false, error: error.message };
  }

  // Auto-resolve related open exceptions
  await sb
    .from("deal_monitoring_exceptions")
    .update({
      status: "resolved",
      resolved_at: now,
      resolution_note: "Resolved by cycle completion.",
    })
    .eq("cycle_id", input.cycleId)
    .eq("status", "open");

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "monitoring_cycle.completed",
    title: "Monitoring review completed",
    detail: "Banker confirmed monitoring submission is satisfactory.",
    visible_to_borrower: true,
    meta: { cycle_id: input.cycleId, reviewed_by: input.reviewedBy },
  });

  return { ok: true };
}
