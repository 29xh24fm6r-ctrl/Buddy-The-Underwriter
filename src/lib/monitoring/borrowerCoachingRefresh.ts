/**
 * Borrower Coaching Refresh — Phase 66B
 *
 * Refreshes borrower coaching based on unprocessed monitoring signals.
 * Processes signals that haven't been fed into coaching yet.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { feedSignalToBorrowerCoaching } from "./underwritingFeedbackLoop";

// ============================================================================
// Types
// ============================================================================

export type RefreshResult = {
  signalsProcessed: number;
  actionsGenerated: number;
  readinessPathUpdated: boolean;
};

// ============================================================================
// Refresh
// ============================================================================

/**
 * Process all unprocessed monitoring signals for borrower coaching.
 * For each signal, generates borrower-safe actions and optionally updates readiness path.
 */
export async function refreshBorrowerCoaching(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<RefreshResult> {
  // Load unprocessed signals
  const { data: signals } = await sb
    .from("buddy_monitoring_signals")
    .select("id, signal_type, severity")
    .eq("deal_id", dealId)
    .eq("fed_into_borrower_coaching", false)
    .order("created_at", { ascending: true })
    .limit(20);

  if (!signals || signals.length === 0) {
    return { signalsProcessed: 0, actionsGenerated: 0, readinessPathUpdated: false };
  }

  let actionsGenerated = 0;

  for (const signal of signals) {
    await feedSignalToBorrowerCoaching(sb, signal.id, dealId, bankId);
    actionsGenerated++; // At least one action per signal
  }

  // Update readiness path status if we have critical/alert signals
  let readinessPathUpdated = false;
  const hasCritical = signals.some((s) => s.severity === "critical" || s.severity === "alert");

  if (hasCritical) {
    const { data: existingPath } = await sb
      .from("buddy_borrower_readiness_paths")
      .select("id, path_status")
      .eq("deal_id", dealId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPath && existingPath.path_status !== "off_track") {
      await sb
        .from("buddy_borrower_readiness_paths")
        .update({ path_status: "at_risk" })
        .eq("id", existingPath.id);
      readinessPathUpdated = true;
    }
  }

  return {
    signalsProcessed: signals.length,
    actionsGenerated,
    readinessPathUpdated,
  };
}
