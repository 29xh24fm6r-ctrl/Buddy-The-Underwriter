import "server-only";

/**
 * Task CRUD — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 §5.3.
 *
 * Tasks stay attached to their target (usually a deal) across brokerage-
 * stage transitions — the schema has no per-stage lifecycle for a task
 * row, so an incomplete task from an earlier stage naturally "carries
 * forward" simply by still being open; nothing has to actively preserve
 * it. Automatically-generated tasks are only ever cancelled explicitly via
 * updateTaskStatus, never implicitly on a stage change — this codebase has
 * no verified way to know an auto-generated task is safe to cancel without
 * staff judgment, so PR3 doesn't guess.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import type { BrokerageTask, TaskCategory, TaskPriority, TaskStatus } from "./types";

export type CreateTaskInput = {
  bankId: string;
  title: string;
  description?: string | null;
  category: TaskCategory;
  dealId?: string | null;
  leadId?: string | null;
  organizationId?: string | null;
  personId?: string | null;
  assignedToClerkUserId?: string | null;
  assignedRole?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
  reminderAt?: string | null;
  recurrenceRule?: string | null;
  dependsOnTaskId?: string | null;
  blocking?: boolean;
  automationSource?: string | null;
  createdByClerkUserId?: string | null;
};

export async function createTask(input: CreateTaskInput, sb: SB = supabaseAdmin()): Promise<BrokerageTask> {
  const targets = [input.dealId, input.leadId, input.organizationId, input.personId].filter(Boolean);
  if (targets.length !== 1) {
    throw new Error("createTask requires exactly one of dealId, leadId, organizationId, or personId.");
  }

  const { data, error } = await sb
    .from("brokerage_tasks")
    .insert({
      bank_id: input.bankId,
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      deal_id: input.dealId ?? null,
      lead_id: input.leadId ?? null,
      organization_id: input.organizationId ?? null,
      person_id: input.personId ?? null,
      assigned_to_clerk_user_id: input.assignedToClerkUserId ?? null,
      assigned_role: input.assignedRole ?? null,
      priority: input.priority ?? "medium",
      due_at: input.dueAt ?? null,
      reminder_at: input.reminderAt ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      depends_on_task_id: input.dependsOnTaskId ?? null,
      blocking: input.blocking ?? false,
      automation_source: input.automationSource ?? null,
      created_by_clerk_user_id: input.createdByClerkUserId ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createTask failed: ${error.message}`);
  return data as BrokerageTask;
}

export type UpdateTaskStatusInput = {
  bankId: string;
  taskId: string;
  status: TaskStatus;
  actorClerkUserId?: string | null;
  completionOutcome?: string | null;
};

export async function updateTaskStatus(input: UpdateTaskStatusInput, sb: SB = supabaseAdmin()): Promise<BrokerageTask> {
  const patch: Record<string, unknown> = { status: input.status, updated_at: new Date().toISOString() };
  if (input.status === "completed") {
    patch.completed_at = new Date().toISOString();
    patch.completed_by_clerk_user_id = input.actorClerkUserId ?? null;
    patch.completion_outcome = input.completionOutcome ?? null;
  }

  const { data, error } = await sb
    .from("brokerage_tasks")
    .update(patch)
    .eq("id", input.taskId)
    .eq("bank_id", input.bankId)
    .select("*")
    .single();
  if (error) throw new Error(`updateTaskStatus failed: ${error.message}`);
  return data as BrokerageTask;
}

export type UpdateTaskFieldsInput = {
  bankId: string;
  taskId: string;
  title?: string;
  description?: string | null;
  assignedToClerkUserId?: string | null;
  assignedRole?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
  reminderAt?: string | null;
  escalationState?: "none" | "flagged" | "escalated";
};

export async function updateTaskFields(input: UpdateTaskFieldsInput, sb: SB = supabaseAdmin()): Promise<BrokerageTask> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.assignedToClerkUserId !== undefined) patch.assigned_to_clerk_user_id = input.assignedToClerkUserId;
  if (input.assignedRole !== undefined) patch.assigned_role = input.assignedRole;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueAt !== undefined) patch.due_at = input.dueAt;
  if (input.reminderAt !== undefined) patch.reminder_at = input.reminderAt;
  if (input.escalationState !== undefined) patch.escalation_state = input.escalationState;

  const { data, error } = await sb
    .from("brokerage_tasks")
    .update(patch)
    .eq("id", input.taskId)
    .eq("bank_id", input.bankId)
    .select("*")
    .single();
  if (error) throw new Error(`updateTaskFields failed: ${error.message}`);
  return data as BrokerageTask;
}

export async function listTasksForDeal(bankId: string, dealId: string, sb: SB = supabaseAdmin()): Promise<BrokerageTask[]> {
  const { data, error } = await sb
    .from("brokerage_tasks")
    .select("*")
    .eq("bank_id", bankId)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listTasksForDeal failed: ${error.message}`);
  return (data ?? []) as BrokerageTask[];
}
