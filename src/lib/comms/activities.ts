import "server-only";

/**
 * Unified structured-activity logging — SPEC-BROKERAGE-OPERATING-SYSTEM-V1
 * PR4 §6.1.
 *
 * Every comms send (email/SMS/call/meeting), manual log, or automated
 * action in this PR funnels through logActivity() so the unified timeline
 * (crm_activities) stays the single source of truth — no parallel comms-
 * log table. Multi-person involvement (a call with a deal AND several
 * people) is modeled via crm_activity_participants alongside the existing
 * single primary target, not by loosening the target CHECK.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";

export type ActivityKind = "note" | "task" | "call" | "email" | "sms" | "meeting" | "stage_change" | "system";
export type ActivityChannel = "email" | "sms" | "call" | "meeting" | "portal" | "system";
export type ActivityDirection = "inbound" | "outbound";
export type ActivityDeliveryState = "queued" | "sent" | "delivered" | "failed" | "bounced" | "stub";
export type ActivitySource = "manual" | "automated";

export type LogActivityInput = {
  bankId: string;
  kind: ActivityKind;
  title: string;
  dealId?: string | null;
  organizationId?: string | null;
  personId?: string | null;
  leadId?: string | null;
  participantPersonIds?: string[];
  direction?: ActivityDirection | null;
  channel?: ActivityChannel | null;
  outcome?: string | null;
  durationSeconds?: number | null;
  followUpRequired?: boolean;
  followUpDueAt?: string | null;
  externalMessageId?: string | null;
  provider?: string | null;
  deliveryState?: ActivityDeliveryState | null;
  source?: ActivitySource;
  actorClerkUserId?: string | null;
  assignedToClerkUserId?: string | null;
  dueAt?: string | null;
  properties?: Record<string, unknown>;
};

export type ActivityRow = {
  id: string;
  bank_id: string;
  kind: ActivityKind;
  [key: string]: unknown;
};

export async function logActivity(input: LogActivityInput, sb: SB = supabaseAdmin()): Promise<ActivityRow> {
  const targets = [input.dealId, input.organizationId, input.personId, input.leadId].filter(Boolean);
  if (targets.length !== 1) {
    throw new Error("logActivity requires exactly one primary target: dealId, organizationId, personId, or leadId.");
  }

  const { data, error } = await sb
    .from("crm_activities")
    .insert({
      bank_id: input.bankId,
      kind: input.kind,
      title: input.title,
      target_deal_id: input.dealId ?? null,
      target_organization_id: input.organizationId ?? null,
      target_person_id: input.personId ?? null,
      target_lead_id: input.leadId ?? null,
      direction: input.direction ?? null,
      channel: input.channel ?? null,
      outcome: input.outcome ?? null,
      duration_seconds: input.durationSeconds ?? null,
      follow_up_required: input.followUpRequired ?? false,
      follow_up_due_at: input.followUpDueAt ?? null,
      external_message_id: input.externalMessageId ?? null,
      provider: input.provider ?? null,
      delivery_state: input.deliveryState ?? null,
      source: input.source ?? "manual",
      actor_clerk_user_id: input.actorClerkUserId ?? null,
      assigned_to_clerk_user_id: input.assignedToClerkUserId ?? null,
      due_at: input.dueAt ?? null,
      properties: input.properties ?? {},
    })
    .select("*")
    .single();
  if (error) throw new Error(`logActivity failed: ${error.message}`);
  const activity = data as ActivityRow;

  if (input.participantPersonIds && input.participantPersonIds.length > 0) {
    const rows = input.participantPersonIds.map((personId) => ({
      bank_id: input.bankId,
      activity_id: activity.id,
      person_id: personId,
    }));
    const { error: participantErr } = await sb.from("crm_activity_participants").insert(rows);
    if (participantErr) throw new Error(`logActivity: failed to attach participants (${participantErr.message})`);
  }

  return activity;
}

export async function listParticipantsForActivity(bankId: string, activityId: string, sb: SB = supabaseAdmin()): Promise<string[]> {
  const { data, error } = await sb
    .from("crm_activity_participants")
    .select("person_id")
    .eq("bank_id", bankId)
    .eq("activity_id", activityId);
  if (error) throw new Error(`listParticipantsForActivity failed: ${error.message}`);
  return ((data ?? []) as Array<{ person_id: string }>).map((r) => r.person_id);
}
