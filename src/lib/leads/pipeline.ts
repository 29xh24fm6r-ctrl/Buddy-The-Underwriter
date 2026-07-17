import "server-only";

/**
 * Lead pipeline actions — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR2.
 *
 * Stage transitions and contact-attempt logging. Every transition is
 * validated against the stage machine (stages.ts) before it touches the
 * database, and every transition/attempt is written to crm_activities
 * (target_lead_id) so the lead has the same audited timeline PR1 gave
 * organizations and people.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { canTransition, isValidLeadStage, type LeadStage } from "./stages";
import { stageRequiresNextAction } from "./sla";

export type BrokerageLead = {
  id: string;
  bank_id: string;
  status: LeadStage;
  stage_entered_at: string;
  owner_clerk_user_id: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  next_action: string | null;
  next_action_due_at: string | null;
  last_attempted_contact_at: string | null;
  last_successful_contact_at: string | null;
  disqualification_reason: string | null;
  lost_reason: string | null;
  converted_deal_id: string | null;
  [key: string]: unknown;
};

async function getLeadOrThrow(bankId: string, leadId: string, sb: SB): Promise<BrokerageLead> {
  const { data, error } = await sb
    .from("brokerage_leads")
    .select("*")
    .eq("id", leadId)
    .eq("bank_id", bankId)
    .single();
  if (error || !data) throw new Error(`Lead not found (${error?.message ?? "no such lead"}).`);
  return data as BrokerageLead;
}

export type TransitionLeadStageInput = {
  bankId: string;
  leadId: string;
  toStage: string;
  actorClerkUserId: string;
  reason?: string | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
};

export async function transitionLeadStage(input: TransitionLeadStageInput, sb: SB = supabaseAdmin()): Promise<BrokerageLead> {
  if (!isValidLeadStage(input.toStage)) {
    throw new Error(`Unknown lead stage: ${input.toStage}`);
  }
  if (input.toStage === "converted") {
    throw new Error("Lead can only reach 'converted' through convertLeadToDeal, not a direct transition.");
  }

  const lead = await getLeadOrThrow(input.bankId, input.leadId, sb);
  const toStage = input.toStage as LeadStage;

  if (!canTransition(lead.status, toStage)) {
    throw new Error(`Cannot transition lead from '${lead.status}' to '${toStage}'.`);
  }

  if (toStage === "disqualified" && !input.reason) {
    throw new Error("A lead cannot be marked disqualified without a reason.");
  }
  if (toStage === "lost" && !input.reason) {
    throw new Error("A lead cannot be marked lost without a reason.");
  }

  const nextActionDueAt = input.nextActionDueAt ?? lead.next_action_due_at ?? null;
  if (stageRequiresNextAction(toStage) && !nextActionDueAt) {
    throw new Error(`Stage '${toStage}' requires a next-action due date before a lead can enter it.`);
  }

  const patch: Record<string, unknown> = {
    status: toStage,
    stage_entered_at: new Date().toISOString(),
  };
  if (input.nextAction !== undefined) patch.next_action = input.nextAction;
  if (input.nextActionDueAt !== undefined) patch.next_action_due_at = input.nextActionDueAt;
  if (toStage === "disqualified") patch.disqualification_reason = input.reason;
  if (toStage === "lost") patch.lost_reason = input.reason;

  const { data, error } = await sb
    .from("brokerage_leads")
    .update(patch)
    .eq("id", input.leadId)
    .eq("bank_id", input.bankId)
    .select("*")
    .single();
  if (error) throw new Error(`transitionLeadStage update failed: ${error.message}`);

  await sb.from("crm_activities").insert({
    bank_id: input.bankId,
    kind: "stage_change",
    title: `Lead stage: ${lead.status} → ${toStage}`,
    properties: { fromStage: lead.status, toStage, reason: input.reason ?? null },
    actor_clerk_user_id: input.actorClerkUserId,
    target_lead_id: input.leadId,
  });

  return data as BrokerageLead;
}

export type RecordLeadContactAttemptInput = {
  bankId: string;
  leadId: string;
  actorClerkUserId: string;
  channel: "call" | "email" | "meeting";
  outcome: "no_answer" | "left_message" | "connected" | "scheduled_followup";
  notes?: string | null;
};

export async function recordLeadContactAttempt(input: RecordLeadContactAttemptInput, sb: SB = supabaseAdmin()): Promise<BrokerageLead> {
  const lead = await getLeadOrThrow(input.bankId, input.leadId, sb);

  const now = new Date().toISOString();
  const successful = input.outcome === "connected" || input.outcome === "scheduled_followup";

  const patch: Record<string, unknown> = { last_attempted_contact_at: now };
  if (successful) patch.last_successful_contact_at = now;
  // A first contact attempt on a brand-new lead advances it out of "new"
  // automatically — staff shouldn't have to make two separate calls (log
  // attempt, then also move the stage) for the most common action in the
  // pipeline.
  if (lead.status === "new") patch.status = "attempting_contact";

  const { data, error } = await sb
    .from("brokerage_leads")
    .update(patch)
    .eq("id", input.leadId)
    .eq("bank_id", input.bankId)
    .select("*")
    .single();
  if (error) throw new Error(`recordLeadContactAttempt update failed: ${error.message}`);

  await sb.from("crm_activities").insert({
    bank_id: input.bankId,
    kind: input.channel,
    title: `Contact attempt: ${input.outcome.replace("_", " ")}`,
    properties: { outcome: input.outcome, notes: input.notes ?? null },
    actor_clerk_user_id: input.actorClerkUserId,
    target_lead_id: input.leadId,
  });

  return data as BrokerageLead;
}

export type UpdateLeadFieldsInput = {
  bankId: string;
  leadId: string;
  ownerClerkUserId?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  loanProgram?: string | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
  expectedConversionDate?: string | null;
  competitorOrAlternateFinancing?: string | null;
};

export async function updateLeadFields(input: UpdateLeadFieldsInput, sb: SB = supabaseAdmin()): Promise<BrokerageLead> {
  const patch: Record<string, unknown> = {};
  if (input.ownerClerkUserId !== undefined) patch.owner_clerk_user_id = input.ownerClerkUserId;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.loanProgram !== undefined) patch.loan_program = input.loanProgram;
  if (input.nextAction !== undefined) patch.next_action = input.nextAction;
  if (input.nextActionDueAt !== undefined) patch.next_action_due_at = input.nextActionDueAt;
  if (input.expectedConversionDate !== undefined) patch.expected_conversion_date = input.expectedConversionDate;
  if (input.competitorOrAlternateFinancing !== undefined) patch.competitor_or_alternate_financing = input.competitorOrAlternateFinancing;

  const { data, error } = await sb
    .from("brokerage_leads")
    .update(patch)
    .eq("id", input.leadId)
    .eq("bank_id", input.bankId)
    .select("*")
    .single();
  if (error) throw new Error(`updateLeadFields failed: ${error.message}`);
  return data as BrokerageLead;
}
