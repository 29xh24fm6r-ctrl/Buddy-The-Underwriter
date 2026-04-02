import "server-only";

/**
 * Phase 66C — Milestone Completion: Links borrower actions to milestone progress.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Links a borrower action to a milestone by writing the milestone label
 * into the action's evidence_json.
 */
export async function linkActionToMilestone(
  sb: SupabaseClient,
  actionId: string,
  milestoneLabel: string,
): Promise<void> {
  // Read current evidence
  const { data: existing, error: readError } = await sb
    .from("buddy_borrower_actions_taken")
    .select("evidence_json")
    .eq("id", actionId)
    .single();

  if (readError)
    throw new Error(`linkActionToMilestone read failed: ${readError.message}`);

  const evidence: Record<string, unknown> =
    (existing?.evidence_json as Record<string, unknown>) ?? {};
  evidence.milestone_label = milestoneLabel;
  evidence.milestone_linked_at = new Date().toISOString();

  const { error: updateError } = await sb
    .from("buddy_borrower_actions_taken")
    .update({ evidence_json: evidence })
    .eq("id", actionId);

  if (updateError)
    throw new Error(
      `linkActionToMilestone update failed: ${updateError.message}`,
    );
}

/**
 * Computes milestone completion rate for a deal by counting actions
 * that have a milestone_label in their evidence_json and are completed.
 */
export async function getMilestoneCompletionRate(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ total: number; completed: number; rate: number }> {
  const { data, error } = await sb
    .from("buddy_borrower_actions_taken")
    .select("status, evidence_json")
    .eq("deal_id", dealId)
    .not("evidence_json->milestone_label", "is", null);

  if (error)
    throw new Error(
      `getMilestoneCompletionRate failed: ${error.message}`,
    );

  const rows = data ?? [];
  const total = rows.length;
  const completed = rows.filter(
    (r) => (r as { status: string }).status === "completed",
  ).length;

  return {
    total,
    completed,
    rate: total > 0 ? completed / total : 0,
  };
}
