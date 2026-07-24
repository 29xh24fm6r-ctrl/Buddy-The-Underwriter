import "server-only";

/**
 * Phone and meetings — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.3.
 *
 * Discovery found zero PSTN/telephony infrastructure anywhere in this
 * codebase (deal_voice_sessions is an unrelated AI browser-voice-
 * concierge feature, not calling infra). Per the spec's own instruction
 * — "Do not require telephony integration to complete this PR if no
 * provider is provisioned. Build a provider-neutral interface and
 * complete the manual operational workflow" — this module is exactly
 * that: manual outcome/meeting logging only. No click-to-call, no real
 * dialing, no fabricated "call connected" state.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { logActivity, type ActivityRow } from "./activities";
import { createTask } from "@/lib/tasks/tasks";

export type LogCallOutcomeInput = {
  bankId: string;
  dealId?: string | null;
  organizationId?: string | null;
  personId?: string | null;
  leadId?: string | null;
  direction: "inbound" | "outbound";
  outcome: string;
  durationSeconds?: number | null;
  followUpRequired?: boolean;
  followUpDueAt?: string | null;
  actorClerkUserId?: string | null;
};

export async function logCallOutcome(input: LogCallOutcomeInput, sb: SB = supabaseAdmin()): Promise<ActivityRow> {
  return logActivity(
    {
      bankId: input.bankId,
      kind: "call",
      channel: "call",
      direction: input.direction,
      title: `Call ${input.direction === "outbound" ? "made" : "received"}: ${input.outcome}`,
      dealId: input.dealId,
      organizationId: input.organizationId,
      personId: input.personId,
      leadId: input.leadId,
      outcome: input.outcome,
      durationSeconds: input.durationSeconds ?? null,
      followUpRequired: input.followUpRequired ?? false,
      followUpDueAt: input.followUpDueAt ?? null,
      deliveryState: null,
      actorClerkUserId: input.actorClerkUserId ?? null,
    },
    sb,
  );
}

export type LogMeetingInput = {
  bankId: string;
  dealId?: string | null;
  organizationId?: string | null;
  personId?: string | null;
  leadId?: string | null;
  title: string;
  participantPersonIds?: string[];
  meetingLink?: string | null;
  durationSeconds?: number | null;
  outcome?: string | null;
  commitmentsMade?: string[];
  actorClerkUserId?: string | null;
};

/**
 * Records a meeting and — per §6.3 "Automatic task creation from
 * commitments" — turns each stated commitment into a follow-up task
 * (reuses PR3's task system rather than a parallel commitment tracker).
 */
export async function logMeeting(input: LogMeetingInput, sb: SB = supabaseAdmin()): Promise<{ activity: ActivityRow; commitmentTaskIds: string[] }> {
  const activity = await logActivity(
    {
      bankId: input.bankId,
      kind: "meeting",
      channel: "meeting",
      direction: "outbound",
      title: input.title,
      dealId: input.dealId,
      organizationId: input.organizationId,
      personId: input.personId,
      leadId: input.leadId,
      participantPersonIds: input.participantPersonIds,
      outcome: input.outcome ?? null,
      durationSeconds: input.durationSeconds ?? null,
      actorClerkUserId: input.actorClerkUserId ?? null,
      properties: { meetingLink: input.meetingLink ?? null },
    },
    sb,
  );

  const commitmentTaskIds: string[] = [];
  if (input.dealId && input.commitmentsMade && input.commitmentsMade.length > 0) {
    for (const commitment of input.commitmentsMade) {
      const task = await createTask(
        {
          bankId: input.bankId,
          title: commitment,
          category: "internal_review",
          dealId: input.dealId,
          createdByClerkUserId: input.actorClerkUserId ?? null,
        },
        sb,
      );
      commitmentTaskIds.push(task.id);
    }
  }

  return { activity, commitmentTaskIds };
}
