import "server-only";

/**
 * Phase 65K — Workout Action Items
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ActionItemType } from "./types";

export type AddActionItemInput = {
  workoutCaseId: string;
  dealId: string;
  actionType: ActionItemType;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  ownerUserId?: string | null;
  createdBy: string;
};

export async function addWorkoutActionItem(input: AddActionItemInput) {
  const sb = supabaseAdmin();

  const { data: item, error } = await sb.from("deal_workout_action_items").insert({
    workout_case_id: input.workoutCaseId,
    deal_id: input.dealId,
    owner_user_id: input.ownerUserId ?? null,
    action_type: input.actionType,
    title: input.title,
    description: input.description ?? null,
    due_at: input.dueAt ?? null,
    status: "open",
    created_by: input.createdBy,
  }).select("id").single();

  if (error) return { ok: false, itemId: null, error: error.message };

  await sb.from("deal_workout_events").insert({
    workout_case_id: input.workoutCaseId,
    deal_id: input.dealId,
    event_type: "action_item_created",
    actor_user_id: input.createdBy,
    summary: `Action item created: ${input.title}`,
    detail: { action_type: input.actionType, item_id: item.id },
  });

  return { ok: true, itemId: item.id };
}

export type CompleteActionItemInput = {
  actionItemId: string;
  dealId: string;
  completedBy: string;
};

export async function completeWorkoutActionItem(input: CompleteActionItemInput) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: item } = await sb.from("deal_workout_action_items")
    .select("workout_case_id, title")
    .eq("id", input.actionItemId).single();

  if (!item) return { ok: false, error: "Item not found" };

  await sb.from("deal_workout_action_items").update({
    status: "completed",
    completed_at: now,
    updated_at: now,
  }).eq("id", input.actionItemId);

  await sb.from("deal_workout_events").insert({
    workout_case_id: item.workout_case_id,
    deal_id: input.dealId,
    event_type: "action_item_completed",
    actor_user_id: input.completedBy,
    summary: `Action item completed: ${item.title}`,
    detail: { item_id: input.actionItemId },
  });

  return { ok: true };
}
