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

import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { UnderwriterFeedback } from "./types";
import { restoreBankerSubmittedSnapshotAfterFailedDecision } from "@/lib/creditMemo/submission/submitCreditMemoToUnderwriting";

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

  // Verify snapshot provenance before changing state. The same human who
  // certified the banker submission may not finalize their own work.
  const { data: snapshot, error: snapshotLoadError } = await supabase
    .from("credit_memo_snapshots")
    .select("id, status, submitted_by")
    .eq("id", args.snapshotId)
    .eq("deal_id", args.dealId)
    .maybeSingle();

  if (snapshotLoadError) {
    console.error("[recordUnderwriterDecision] snapshot lookup failed", {
      dealId: args.dealId,
      snapshotId: args.snapshotId,
      code: snapshotLoadError.code,
    });
    throw new Error("decision_snapshot_load_failed");
  }
  if (!snapshot || snapshot.status !== "banker_submitted") {
    throw new Error("snapshot_not_in_banker_submitted_state");
  }
  if (
    typeof snapshot.submitted_by !== "string" ||
    snapshot.submitted_by.length === 0
  ) {
    throw new Error("snapshot_submitter_provenance_missing");
  }
  if (snapshot.submitted_by === args.underwriterId) {
    throw new Error("underwriter_separation_of_duties");
  }

  const decidedAt = new Date().toISOString();
  const underwriterFeedback: UnderwriterFeedback = {
    ...args.feedback,
    underwriter_id: args.underwriterId,
    decided_at: decidedAt,
  };

  const nextStatus: "finalized" | "returned" =
    args.feedback.decision === "returned_for_revision"
      ? "returned"
      : "finalized";

  const { error: snapshotError, data: updated } = await supabase
    .from("credit_memo_snapshots")
    .update({
      status: nextStatus,
      underwriter_feedback_json:
        underwriterFeedback as unknown as Record<string, unknown>,
    })
    .eq("id", args.snapshotId)
    .eq("deal_id", args.dealId)
    .eq("status", "banker_submitted")
    .neq("submitted_by", args.underwriterId)
    .select("id")
    .maybeSingle();

  if (snapshotError) {
    console.error("[recordUnderwriterDecision] snapshot update failed", {
      dealId: args.dealId,
      snapshotId: args.snapshotId,
      code: snapshotError.code,
    });
    throw new Error("decision_snapshot_update_failed");
  }
  if (!updated) {
    throw new Error("snapshot_not_in_banker_submitted_state");
  }

  // Mirror to the deal-level memo status so all readers observe the same
  // resolution. A failed mirror is compensated before failure is returned.
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

  if (statusError) {
    console.error("[recordUnderwriterDecision] status mirror failed", {
      dealId: args.dealId,
      snapshotId: args.snapshotId,
      code: statusError.code,
    });

    let compensationFailed = false;
    try {
      const restored =
        await restoreBankerSubmittedSnapshotAfterFailedDecision({
          dealId: args.dealId,
          snapshotId: args.snapshotId,
          expectedStatus: nextStatus,
        });
      compensationFailed = !restored.ok;
      if (!restored.ok) {
        console.error(
          "[recordUnderwriterDecision] snapshot compensation failed",
          {
            dealId: args.dealId,
            snapshotId: args.snapshotId,
            code: restored.code,
          },
        );
      }
    } catch (restoreError) {
      compensationFailed = true;
      console.error(
        "[recordUnderwriterDecision] snapshot compensation threw",
        {
          dealId: args.dealId,
          snapshotId: args.snapshotId,
          error:
            restoreError instanceof Error
              ? restoreError.message
              : String(restoreError),
        },
      );
    }

    if (compensationFailed) {
      Sentry.captureMessage(
        "underwriter decision requires snapshot reconciliation",
        {
          level: "fatal",
          tags: {
            route: "recordUnderwriterDecision",
            failure: "status_mirror_and_compensation_failed",
          },
          extra: {
            dealId: args.dealId,
            snapshotId: args.snapshotId,
            underwriterId: args.underwriterId,
          },
        },
      );
      throw new Error("decision_reconciliation_required");
    }

    throw new Error("decision_status_sync_failed");
  }

  return {
    snapshot_id: args.snapshotId,
    status: nextStatus,
    underwriter_feedback: underwriterFeedback,
  };
}
