import "server-only";

/**
 * Phase 65K — Open Workout Case
 *
 * One active workout per deal. Requires evidence or watchlist promotion.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { WorkoutSeverity, WorkoutStrategy } from "./types";

export type OpenWorkoutInput = {
  dealId: string;
  bankId: string;
  watchlistCaseId?: string | null;
  severity: WorkoutSeverity;
  strategy: WorkoutStrategy;
  openedBy: string;
  assignedTo?: string | null;
};

export type OpenWorkoutResult = {
  ok: boolean;
  caseId: string | null;
  created: boolean;
  error?: string;
};

export async function openWorkoutCase(input: OpenWorkoutInput): Promise<OpenWorkoutResult> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("deal_workout_cases")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { ok: true, caseId: existing.id, created: false };
  }

  const { data: row, error } = await sb
    .from("deal_workout_cases")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      watchlist_case_id: input.watchlistCaseId ?? null,
      status: "active",
      severity: input.severity,
      workout_strategy: input.strategy,
      stage: "triage",
      opened_by: input.openedBy,
      assigned_to: input.assignedTo ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await sb.from("deal_workout_cases").select("id").eq("deal_id", input.dealId).eq("status", "active").single();
      return { ok: true, caseId: raced?.id ?? null, created: false };
    }
    return { ok: false, caseId: null, created: false, error: error.message };
  }

  await sb.from("deal_workout_events").insert({
    workout_case_id: row.id,
    deal_id: input.dealId,
    event_type: "case_opened",
    actor_user_id: input.openedBy,
    summary: `Workout case opened: ${input.strategy.replace(/_/g, " ")}`,
    detail: { severity: input.severity, strategy: input.strategy, from_watchlist: input.watchlistCaseId ?? null },
  });

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "workout.opened",
    title: "Deal entered workout",
    detail: `Strategy: ${input.strategy.replace(/_/g, " ")}. Severity: ${input.severity}.`,
    visible_to_borrower: false,
  });

  return { ok: true, caseId: row.id, created: true };
}
