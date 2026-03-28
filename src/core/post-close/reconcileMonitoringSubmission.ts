import "server-only";

/**
 * Phase 65I — Reconcile Monitoring Submission
 *
 * Maps borrower evidence into monitoring cycle progress.
 * Safe for repeated calls. Does not auto-complete — banker review required.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type ReconcileSubmissionInput = {
  cycleId: string;
  dealId: string;
};

export type ReconcileSubmissionResult = {
  ok: boolean;
  previousStatus: string;
  newStatus: string;
  error?: string;
};

export async function reconcileMonitoringSubmission(
  input: ReconcileSubmissionInput,
): Promise<ReconcileSubmissionResult> {
  const sb = supabaseAdmin();

  const { data: cycle } = await sb
    .from("deal_monitoring_cycles")
    .select("id, status, borrower_campaign_id, submission_received_at")
    .eq("id", input.cycleId)
    .single();

  if (!cycle) {
    return { ok: false, previousStatus: "", newStatus: "", error: "Cycle not found" };
  }

  const previousStatus = cycle.status;

  // Only transition from due/overdue/exception_open to submitted
  const submittableStatuses = ["due", "overdue", "exception_open"];
  if (!submittableStatuses.includes(cycle.status)) {
    return { ok: true, previousStatus, newStatus: previousStatus };
  }

  // If campaign exists, check if items are completed
  if (cycle.borrower_campaign_id) {
    const { data: campaign } = await sb
      .from("borrower_request_campaigns")
      .select("status")
      .eq("id", cycle.borrower_campaign_id)
      .maybeSingle();

    // Only mark submitted if campaign shows submission evidence
    if (
      campaign &&
      !["completed", "in_progress"].includes(campaign.status)
    ) {
      return { ok: true, previousStatus, newStatus: previousStatus };
    }
  }

  const now = new Date().toISOString();

  const { error } = await sb
    .from("deal_monitoring_cycles")
    .update({
      status: "submitted",
      submission_received_at: cycle.submission_received_at ?? now,
    })
    .eq("id", input.cycleId)
    .in("status", submittableStatuses);

  if (error) {
    return { ok: false, previousStatus, newStatus: previousStatus, error: error.message };
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "monitoring_cycle.submitted",
    title: "Monitoring submission received",
    detail: "Borrower submission recorded. Awaiting banker review.",
    visible_to_borrower: true,
    meta: { cycle_id: input.cycleId },
  });

  return { ok: true, previousStatus, newStatus: "submitted" };
}
