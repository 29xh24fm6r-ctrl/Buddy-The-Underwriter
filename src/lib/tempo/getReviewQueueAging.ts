import "server-only";

/**
 * Phase 65G — Review Queue Aging
 *
 * Counts uploads waiting for banker review and stale banker tasks.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { OBJECT_SLA_POLICY } from "@/core/sla/slaPolicy";

export type ReviewQueueSummary = {
  uploadsWaitingReview: number;
  bankerTasksStale: number;
};

export async function getReviewQueueAging(
  dealId: string,
): Promise<ReviewQueueSummary> {
  const sb = supabaseAdmin();
  const staleThreshold = new Date(
    Date.now() - OBJECT_SLA_POLICY.uploadsWaitingReview.watchHours * 3600 * 1000,
  ).toISOString();

  // Uploads waiting for review (uploaded but not confirmed/submitted beyond threshold)
  const { count: waitingReview } = await sb
    .from("borrower_request_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("status", "uploaded")
    .lt("created_at", staleThreshold);

  // Stale banker task-only canonical executions (created but no follow-up)
  const { count: staleTasks } = await sb
    .from("canonical_action_executions")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("execution_status", "created")
    .lt("created_at", staleThreshold);

  return {
    uploadsWaitingReview: waitingReview ?? 0,
    bankerTasksStale: staleTasks ?? 0,
  };
}
