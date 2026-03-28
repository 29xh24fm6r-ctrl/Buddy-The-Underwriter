import "server-only";

/**
 * Phase 65K — Escalate Watchlist → Workout
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { openWorkoutCase } from "./openWorkoutCase";
import type { WorkoutSeverity, WorkoutStrategy } from "./types";

export type EscalateInput = {
  watchlistCaseId: string;
  dealId: string;
  bankId: string;
  escalatedBy: string;
  workoutSeverity: WorkoutSeverity;
  workoutStrategy: WorkoutStrategy;
};

export async function escalateWatchlistToWorkout(input: EscalateInput) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // Mark watchlist as escalated
  await sb.from("deal_watchlist_cases").update({
    status: "escalated_to_workout",
    escalated_at: now,
    updated_at: now,
  }).eq("id", input.watchlistCaseId);

  await sb.from("deal_watchlist_events").insert({
    watchlist_case_id: input.watchlistCaseId,
    deal_id: input.dealId,
    event_type: "escalated_to_workout",
    actor_user_id: input.escalatedBy,
    summary: "Watchlist case escalated to workout",
  });

  // Open workout case
  const result = await openWorkoutCase({
    dealId: input.dealId,
    bankId: input.bankId,
    watchlistCaseId: input.watchlistCaseId,
    severity: input.workoutSeverity,
    strategy: input.workoutStrategy,
    openedBy: input.escalatedBy,
  });

  return result;
}
