import "server-only";

/**
 * Phase 65K — Update Workout Stage / Strategy / Resolve / Return-to-Pass
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { WorkoutStage, WorkoutStrategy, WorkoutStatus } from "./types";

export type UpdateWorkoutStageInput = {
  workoutCaseId: string;
  dealId: string;
  stage: WorkoutStage;
  updatedBy: string;
};

export async function updateWorkoutStage(input: UpdateWorkoutStageInput) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  await sb.from("deal_workout_cases").update({
    stage: input.stage,
    updated_at: now,
  }).eq("id", input.workoutCaseId);

  await sb.from("deal_workout_events").insert({
    workout_case_id: input.workoutCaseId,
    deal_id: input.dealId,
    event_type: "stage_changed",
    actor_user_id: input.updatedBy,
    summary: `Workout stage changed to ${input.stage.replace(/_/g, " ")}`,
    detail: { stage: input.stage },
  });

  return { ok: true };
}

export type UpdateWorkoutStrategyInput = {
  workoutCaseId: string;
  dealId: string;
  strategy: WorkoutStrategy;
  updatedBy: string;
};

export async function updateWorkoutStrategy(input: UpdateWorkoutStrategyInput) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  await sb.from("deal_workout_cases").update({
    workout_strategy: input.strategy,
    updated_at: now,
  }).eq("id", input.workoutCaseId);

  await sb.from("deal_workout_events").insert({
    workout_case_id: input.workoutCaseId,
    deal_id: input.dealId,
    event_type: "strategy_changed",
    actor_user_id: input.updatedBy,
    summary: `Workout strategy changed to ${input.strategy.replace(/_/g, " ")}`,
    detail: { strategy: input.strategy },
  });

  return { ok: true };
}

export type ResolveWorkoutInput = {
  workoutCaseId: string;
  dealId: string;
  resolvedBy: string;
  resolutionOutcome: string;
  newStatus: WorkoutStatus;
};

export async function resolveWorkoutCase(input: ResolveWorkoutInput) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  await sb.from("deal_workout_cases").update({
    status: input.newStatus,
    resolution_outcome: input.resolutionOutcome,
    resolved_at: now,
    updated_at: now,
  }).eq("id", input.workoutCaseId);

  await sb.from("deal_workout_events").insert({
    workout_case_id: input.workoutCaseId,
    deal_id: input.dealId,
    event_type: "resolved",
    actor_user_id: input.resolvedBy,
    summary: `Workout resolved: ${input.resolutionOutcome}`,
    detail: { status: input.newStatus, outcome: input.resolutionOutcome },
  });

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "workout.resolved",
    title: `Workout ${input.newStatus.replace(/_/g, " ")}`,
    detail: input.resolutionOutcome,
    visible_to_borrower: false,
  });

  return { ok: true };
}

export type ReturnToPassInput = {
  workoutCaseId: string;
  dealId: string;
  resolvedBy: string;
  summary: string;
};

export async function returnDealToPass(input: ReturnToPassInput) {
  return resolveWorkoutCase({
    workoutCaseId: input.workoutCaseId,
    dealId: input.dealId,
    resolvedBy: input.resolvedBy,
    resolutionOutcome: input.summary,
    newStatus: "returned_to_pass",
  });
}
