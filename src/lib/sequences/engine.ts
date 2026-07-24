import "server-only";

/**
 * Sequence engine — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.6.
 *
 * Advancement follows the same "re-validate the stop condition at fire
 * time, deactivate on failure" shape as
 * src/lib/borrower-reminders/processor.ts — every tick re-checks whether
 * an enrollment should still be running *before* firing its next step,
 * rather than only checking once at enrollment time.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { getSequenceDefinition, type SequenceEntityType } from "./catalog";
import { createTask } from "@/lib/tasks/tasks";
import { logActivity } from "@/lib/comms/activities";
import { getTemplate, renderTemplate } from "@/lib/comms/templates";

export type SequenceEnrollment = {
  id: string;
  bank_id: string;
  sequence_key: string;
  entity_type: SequenceEntityType;
  entity_id: string;
  status: "active" | "stopped" | "completed";
  current_step: number;
  next_step_due_at: string | null;
  enrolled_at: string;
};

export type EnrollInSequenceInput = {
  bankId: string;
  sequenceKey: string;
  entityType: SequenceEntityType;
  entityId: string;
  enrolledByClerkUserId?: string | null;
};

export async function enrollInSequence(input: EnrollInSequenceInput, sb: SB = supabaseAdmin()): Promise<SequenceEnrollment> {
  const definition = getSequenceDefinition(input.sequenceKey);
  if (!definition) throw new Error(`Unknown sequence: ${input.sequenceKey}`);
  if (definition.entityType !== input.entityType) {
    throw new Error(`Sequence '${input.sequenceKey}' is for entityType '${definition.entityType}', not '${input.entityType}'.`);
  }

  const firstStep = definition.steps[0];
  const nextStepDueAt = new Date(Date.now() + firstStep.dayOffset * 24 * 3600 * 1000).toISOString();

  const { data, error } = await sb
    .from("crm_sequence_enrollments")
    .insert({
      bank_id: input.bankId,
      sequence_key: input.sequenceKey,
      entity_type: input.entityType,
      entity_id: input.entityId,
      enrolled_by_clerk_user_id: input.enrolledByClerkUserId ?? null,
      next_step_due_at: nextStepDueAt,
    })
    .select("*")
    .single();
  if (error) throw new Error(`enrollInSequence failed: ${error.message}`);
  return data as SequenceEnrollment;
}

export type StopSequenceInput = { bankId: string; enrollmentId: string; reason: string };

export async function stopSequence(input: StopSequenceInput, sb: SB = supabaseAdmin()): Promise<void> {
  const { error } = await sb
    .from("crm_sequence_enrollments")
    .update({ status: "stopped", stop_reason: input.reason, stopped_at: new Date().toISOString() })
    .eq("id", input.enrollmentId)
    .eq("bank_id", input.bankId)
    .eq("status", "active"); // no-op if already stopped/completed — first stop wins
  if (error) throw new Error(`stopSequence failed: ${error.message}`);
}

type StopCheckResult = { shouldStop: boolean; reason: string | null };

async function checkStopCondition(enrollment: SequenceEnrollment, sb: SB): Promise<StopCheckResult> {
  if (enrollment.entity_type === "lead") {
    const { data: lead } = await sb
      .from("brokerage_leads")
      .select("status, do_not_contact, last_successful_contact_at")
      .eq("id", enrollment.entity_id)
      .maybeSingle();
    if (!lead) return { shouldStop: true, reason: "lead not found" };
    if (lead.do_not_contact) return { shouldStop: true, reason: "do_not_contact" };
    if (lead.status === "converted") return { shouldStop: true, reason: "lead converted" };
    if (lead.status === "disqualified") return { shouldStop: true, reason: "lead disqualified" };
    if (lead.status === "withdrawn" || lead.status === "lost") return { shouldStop: true, reason: `lead ${lead.status}` };
    if (lead.last_successful_contact_at && lead.last_successful_contact_at > enrollment.enrolled_at) {
      return { shouldStop: true, reason: "recipient responded" };
    }
    return { shouldStop: false, reason: null };
  }

  if (enrollment.entity_type === "deal") {
    const { data: deal } = await sb
      .from("deals")
      .select("brokerage_stage")
      .eq("id", enrollment.entity_id)
      .maybeSingle();
    if (!deal) return { shouldStop: true, reason: "deal not found" };
    if (["funded", "post_close", "withdrawn", "declined", "lost"].includes(deal.brokerage_stage ?? "")) {
      if (enrollment.sequence_key !== "post_funding_referral_follow_up") {
        return { shouldStop: true, reason: `deal reached terminal stage '${deal.brokerage_stage}'` };
      }
    }
    if (enrollment.sequence_key === "missing_document_chase" && deal.brokerage_stage && deal.brokerage_stage !== "document_collection" && deal.brokerage_stage !== "application") {
      return { shouldStop: true, reason: "deal moved past document collection" };
    }
    if (enrollment.sequence_key === "submitted_deal_lender_follow_up" && deal.brokerage_stage !== "submitted") {
      return { shouldStop: true, reason: "deal is no longer in submitted stage" };
    }
    return { shouldStop: false, reason: null };
  }

  // organization — no lifecycle stage to check; manual stop is the only lever today.
  return { shouldStop: false, reason: null };
}

async function fireStep(enrollment: SequenceEnrollment, sb: SB): Promise<void> {
  const definition = getSequenceDefinition(enrollment.sequence_key);
  if (!definition) return;
  const step = definition.steps[enrollment.current_step];
  if (!step) return;

  const targetField = enrollment.entity_type === "lead" ? "leadId" : enrollment.entity_type === "deal" ? "dealId" : "organizationId";

  if (step.action === "create_task") {
    if (enrollment.entity_type === "deal") {
      await createTask({ bankId: enrollment.bank_id, title: step.title, category: step.category ?? "other", dealId: enrollment.entity_id, automationSource: `sequence:${enrollment.sequence_key}:${enrollment.current_step}` }, sb);
    } else {
      await logActivity({ bankId: enrollment.bank_id, kind: "task", title: step.title, [targetField]: enrollment.entity_id, source: "automated", dueAt: new Date().toISOString() } as any, sb);
    }
  } else if (step.action === "add_activity") {
    await logActivity({ bankId: enrollment.bank_id, kind: "system", title: step.title, [targetField]: enrollment.entity_id, source: "automated" } as any, sb);
  } else if (step.action === "queue_communication_for_approval") {
    let body = step.title;
    if (step.templateTriggerKey) {
      const template = await getTemplate(enrollment.bank_id, step.templateTriggerKey, "email", sb);
      if (template) body = renderTemplate(template.body, {});
    }
    if (enrollment.entity_type === "deal") {
      await createTask({ bankId: enrollment.bank_id, title: `Review & send: ${step.title}`, description: body, category: "internal_review", dealId: enrollment.entity_id, automationSource: `sequence:${enrollment.sequence_key}:${enrollment.current_step}` }, sb);
    } else {
      await logActivity({ bankId: enrollment.bank_id, kind: "system", title: `Draft ready: ${step.title}`, [targetField]: enrollment.entity_id, source: "automated", properties: { draftedBody: body } } as any, sb);
    }
  }
}

export type AdvanceSequencesResult = { checked: number; advanced: number; stopped: number; completed: number };

export async function advanceSequences(bankId: string, sb: SB = supabaseAdmin()): Promise<AdvanceSequencesResult> {
  const now = new Date().toISOString();
  const { data: due } = await sb
    .from("crm_sequence_enrollments")
    .select("*")
    .eq("bank_id", bankId)
    .eq("status", "active")
    .lte("next_step_due_at", now);

  const enrollments = (due ?? []) as SequenceEnrollment[];
  let advanced = 0;
  let stopped = 0;
  let completed = 0;

  for (const enrollment of enrollments) {
    const stopCheck = await checkStopCondition(enrollment, sb);
    if (stopCheck.shouldStop) {
      await sb
        .from("crm_sequence_enrollments")
        .update({ status: "stopped", stop_reason: stopCheck.reason, stopped_at: now })
        .eq("id", enrollment.id)
        .eq("status", "active");
      stopped++;
      continue;
    }

    await fireStep(enrollment, sb);

    const definition = getSequenceDefinition(enrollment.sequence_key);
    const nextIndex = enrollment.current_step + 1;
    const nextStep = definition?.steps[nextIndex];

    if (!nextStep) {
      await sb.from("crm_sequence_enrollments").update({ status: "completed", completed_at: now, current_step: nextIndex }).eq("id", enrollment.id).eq("status", "active");
      completed++;
    } else {
      const nextDueAt = new Date(Date.now() + nextStep.dayOffset * 24 * 3600 * 1000).toISOString();
      await sb.from("crm_sequence_enrollments").update({ current_step: nextIndex, next_step_due_at: nextDueAt, updated_at: now }).eq("id", enrollment.id).eq("status", "active");
      advanced++;
    }
  }

  return { checked: enrollments.length, advanced, stopped, completed };
}
