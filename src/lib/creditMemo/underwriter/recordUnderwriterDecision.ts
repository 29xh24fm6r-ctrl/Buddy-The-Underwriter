// Records the underwriter's decision against a banker-submitted snapshot.
//
// Allowed transitions:
//   banker_submitted → finalized        (approved | declined)
//   banker_submitted → returned         (returned_for_revision)
//
// The DB trigger ensures the certified payload (memo_output_json,
// banker_certification_json, etc.) is not mutated. Only
// underwriter_feedback_json and status change.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { UnderwriterFeedback } from "./types";

export type RecordUnderwriterDecisionArgs = {
  dealId: string;
  snapshotId: string;
  underwriterId: string;
  feedback: Omit<UnderwriterFeedback, "underwriter_id" | "decided_at">;
};

export type RecordUnderwriterDecisionResult = {
  snapshot_id: string;
  status: "finalized" | "returned";
  underwriter_feedback: UnderwriterFeedback;
};

export async function recordUnderwriterDecision(
  args: RecordUnderwriterDecisionArgs,
): Promise<RecordUnderwriterDecisionResult> {
  const supabase = supabaseAdmin();

  const decidedAt = new Date().toISOString();

  const underwriterFeedback: UnderwriterFeedback = {
    ...args.feedback,
    underwriter_id: args.underwriterId,
    decided_at: decidedAt,
  };

  const nextStatus: "finalized" | "returned" =
    args.feedback.decision === "returned_for_revision" ? "returned" : "finalized";

  const { error: snapshotError, data: updated } = await supabase
    .from("credit_memo_snapshots")
    .update({
      status: nextStatus,
      underwriter_feedback_json: underwriterFeedback as unknown as Record<string, unknown>,
    })
    .eq("id", args.snapshotId)
    .eq("deal_id", args.dealId)
    .eq("status", "banker_submitted")
    .select("id")
    .maybeSingle();

  if (snapshotError) throw snapshotError;
  if (!updated) {
    throw new Error(
      "snapshot_not_in_banker_submitted_state: cannot record decision against this snapshot",
    );
  }

  // Mirror to the deal-level memo status so consumers reading
  // deal_credit_memo_status see the resolution.
  const dealStatusValue =
    args.feedback.decision === "returned_for_revision"
      ? "returned_for_revision"
      : args.feedback.decision;

  const { error: statusError } = await supabase
    .from("deal_credit_memo_status")
    .upsert(
      {
        deal_id: args.dealId,
        active_memo_snapshot_id: args.snapshotId,
        current_status: dealStatusValue,
        updated_by: args.underwriterId,
        updated_at: decidedAt,
      },
      { onConflict: "deal_id" },
    );

  if (statusError) throw statusError;

  return {
    snapshot_id: args.snapshotId,
    status: nextStatus,
    underwriter_feedback: underwriterFeedback,
  };
}
