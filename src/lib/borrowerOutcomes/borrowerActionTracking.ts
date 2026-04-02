import "server-only";

/**
 * Phase 66C — Borrower Action Tracking: Tracks borrower actions taken in response to guidance.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface BorrowerActionInput {
  bankId: string;
  dealId: string;
  readinessPathId?: string;
  actionKey: string;
  actionSource: string;
  status: string;
  evidence?: Record<string, unknown>;
}

export interface BorrowerAction {
  id: string;
  bank_id: string;
  deal_id: string;
  readiness_path_id: string | null;
  action_key: string;
  action_source: string;
  status: string;
  evidence_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Records a borrower action. Returns the action id.
 */
export async function recordBorrowerAction(
  sb: SupabaseClient,
  input: BorrowerActionInput,
): Promise<string> {
  const { data, error } = await sb
    .from("buddy_borrower_actions_taken")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      readiness_path_id: input.readinessPathId ?? null,
      action_key: input.actionKey,
      action_source: input.actionSource,
      status: input.status,
      evidence_json: input.evidence ?? null,
    })
    .select("id")
    .single();

  if (error)
    throw new Error(`recordBorrowerAction failed: ${error.message}`);
  return data.id as string;
}

/**
 * Updates the status (and optionally evidence) of an existing borrower action.
 */
export async function updateActionStatus(
  sb: SupabaseClient,
  actionId: string,
  status: string,
  evidence?: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (evidence !== undefined) {
    update.evidence_json = evidence;
  }

  const { error } = await sb
    .from("buddy_borrower_actions_taken")
    .update(update)
    .eq("id", actionId);

  if (error) throw new Error(`updateActionStatus failed: ${error.message}`);
}

/**
 * Retrieves all borrower actions for a deal.
 */
export async function getActionsForDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<BorrowerAction[]> {
  const { data, error } = await sb
    .from("buddy_borrower_actions_taken")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getActionsForDeal failed: ${error.message}`);
  return (data ?? []) as BorrowerAction[];
}
