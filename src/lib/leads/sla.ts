import "server-only";

/**
 * Lead SLA policy — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR2 §4.5.
 *
 * A small, pure, centrally-defined policy module (mirroring the existing
 * src/core/sla/slaPolicy.ts pattern for deals) so operational thresholds
 * live in one place instead of being hardcoded across UI components. Every
 * function here takes an explicit `now` so behavior is deterministic and
 * unit-testable without mocking the system clock.
 */

import type { LeadStage } from "./stages";

export const LEAD_SLA_POLICY = {
  // "New lead must receive first attempt within one business hour."
  firstContactBusinessHours: 1,
  // "No-contact lead requires repeated attempts according to a defined
  // schedule" — hours-since-creation checkpoints for the no-contact-attempted
  // queue once the first-contact window has already passed.
  noContactFollowUpScheduleHours: [1, 24, 72, 168],
  // Stages considered "open" for stale/overdue purposes — terminal stages
  // and `converted` are excluded since they're no longer being worked.
  staleAfterHoursWithNoActivity: 120,
} as const;

const STAGES_REQUIRING_NEXT_ACTION: readonly LeadStage[] = ["qualified", "engagement_pending"];

export function stageRequiresNextAction(stage: LeadStage): boolean {
  return STAGES_REQUIRING_NEXT_ACTION.includes(stage);
}

/** Mon-Fri, 9am-5pm-equivalent business-hour count between two instants (UTC calendar days, weekends excluded). */
export function businessHoursSince(from: Date, now: Date): number {
  if (now <= from) return 0;
  let hours = 0;
  const cursor = new Date(from);
  while (cursor < now) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) hours += 1;
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return hours;
}

export type LeadSlaInput = {
  status: LeadStage;
  created_at: string;
  last_attempted_contact_at: string | null;
  next_action_due_at: string | null;
};

export type LeadSlaState = {
  firstContactOverdue: boolean;
  nextActionOverdue: boolean;
  missingRequiredNextAction: boolean;
  isOverdue: boolean;
};

export function computeLeadSlaState(lead: LeadSlaInput, now: Date = new Date()): LeadSlaState {
  const firstContactOverdue =
    !lead.last_attempted_contact_at &&
    (lead.status === "new" || lead.status === "attempting_contact") &&
    businessHoursSince(new Date(lead.created_at), now) > LEAD_SLA_POLICY.firstContactBusinessHours;

  const nextActionOverdue = !!lead.next_action_due_at && new Date(lead.next_action_due_at) < now;

  const missingRequiredNextAction = stageRequiresNextAction(lead.status) && !lead.next_action_due_at;

  return {
    firstContactOverdue,
    nextActionOverdue,
    missingRequiredNextAction,
    isOverdue: firstContactOverdue || nextActionOverdue || missingRequiredNextAction,
  };
}
