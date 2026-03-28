/**
 * Phase 65G — Escalation Candidate Derivation
 *
 * Converts aging snapshot + stuck reasons into escalation candidates.
 * Pure function — no DB, no side effects.
 */

import type { DealAgingSnapshot, EscalationCandidate, StuckReasonCode } from "./types";

const REASON_TO_ESCALATION: Record<
  StuckReasonCode,
  (snap: DealAgingSnapshot) => EscalationCandidate
> = {
  stage_overdue: (snap) => ({
    escalationCode: "stage_overdue",
    severity: snap.stageAgeHours >= 168 ? "critical" : "urgent",
    source: "sla_policy",
    relatedObjectType: "stage",
    relatedObjectId: snap.canonicalStage,
    message: `Deal has been in "${snap.canonicalStage}" for ${snap.stageAgeHours}h, exceeding SLA.`,
  }),
  primary_action_stale: (snap) => ({
    escalationCode: "primary_action_stale",
    severity: "urgent",
    source: "canonical_action",
    relatedObjectType: "primary_action",
    relatedObjectId: snap.primaryActionCode ?? undefined,
    message: `Primary action "${snap.primaryActionCode}" has been unexecuted for ${snap.primaryActionAgeHours}h.`,
  }),
  borrower_unresponsive: (snap) => ({
    escalationCode: "borrower_reminders_exhausted",
    severity: snap.borrowerCampaignsOverdue > 1 ? "urgent" : "watch",
    source: "borrower_campaign",
    message: `${snap.borrowerCampaignsOverdue} borrower campaign(s) overdue with no progress.`,
  }),
  borrower_opened_not_submitted: () => ({
    escalationCode: "borrower_partial_progress",
    severity: "watch",
    source: "borrower_campaign",
    message: "Borrower has uploaded documents but has not completed submission.",
  }),
  uploads_waiting_for_review: (snap) => ({
    escalationCode: "uploads_waiting_review",
    severity: "watch",
    source: "review_queue",
    message: `Borrower uploads waiting for banker review (${snap.bankerTasksStale} stale tasks).`,
  }),
  memo_gap_aging: () => ({
    escalationCode: "memo_stage_overdue",
    severity: "urgent",
    source: "sla_policy",
    relatedObjectType: "blocker",
    message: "Memo-related blockers remain unresolved beyond SLA threshold.",
  }),
  pricing_waiting_on_assumptions: () => ({
    escalationCode: "pricing_assumptions_overdue",
    severity: "watch",
    source: "sla_policy",
    relatedObjectType: "blocker",
    message: "Pricing assumptions or risk pricing not finalized beyond SLA threshold.",
  }),
  closing_stalled: (snap) => ({
    escalationCode: "closing_stage_overdue",
    severity: "urgent",
    source: "sla_policy",
    relatedObjectType: "stage",
    relatedObjectId: "closing_in_progress",
    message: `Closing has been in progress for ${snap.stageAgeHours}h without completion.`,
  }),
  banker_inactive_on_critical_action: (snap) => ({
    escalationCode: "banker_inactive_critical",
    severity: "critical",
    source: "canonical_action",
    relatedObjectType: "primary_action",
    relatedObjectId: snap.primaryActionCode ?? undefined,
    message: `Critical action "${snap.primaryActionCode}" has no banker activity for ${snap.primaryActionAgeHours}h.`,
  }),
};

export function deriveEscalationCandidates(
  snapshot: DealAgingSnapshot,
): EscalationCandidate[] {
  return snapshot.stuckReasonCodes
    .map((code) => REASON_TO_ESCALATION[code]?.(snapshot))
    .filter((c): c is EscalationCandidate => c !== undefined);
}
