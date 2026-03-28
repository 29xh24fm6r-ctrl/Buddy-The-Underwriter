/**
 * Phase 65G — SLA & Tempo Intelligence Types
 *
 * Time intelligence is a deterministic overlay.
 * No SLA decision may depend on Omega.
 */

export type DealUrgencyBucket =
  | "healthy"
  | "watch"
  | "urgent"
  | "critical";

export type EscalationSeverity =
  | "info"
  | "watch"
  | "urgent"
  | "critical";

export type AutoAdvanceTriggerCode =
  | "borrower_campaigns_complete"
  | "readiness_blockers_cleared"
  | "builder_requirements_complete"
  | "memo_ready_for_review"
  | "underwriting_ready"
  | "closing_requirements_complete";

export type StuckReasonCode =
  | "stage_overdue"
  | "primary_action_stale"
  | "borrower_unresponsive"
  | "borrower_opened_not_submitted"
  | "uploads_waiting_for_review"
  | "memo_gap_aging"
  | "pricing_waiting_on_assumptions"
  | "closing_stalled"
  | "banker_inactive_on_critical_action";

export type DealAgingSnapshot = {
  dealId: string;
  canonicalStage: string;
  stageStartedAt: string | null;
  stageAgeHours: number;
  primaryActionCode: string | null;
  primaryActionAgeHours: number | null;
  borrowerCampaignsOpen: number;
  borrowerCampaignsOverdue: number;
  criticalItemsOverdue: number;
  bankerTasksStale: number;
  isStageOverdue: boolean;
  isPrimaryActionStale: boolean;
  isDealStuck: boolean;
  urgencyScore: number;
  urgencyBucket: DealUrgencyBucket;
  stuckReasonCodes: StuckReasonCode[];
};

export type AutoAdvanceEvaluation = {
  eligible: boolean;
  fromStage: string | null;
  toStage: string | null;
  triggerCode: AutoAdvanceTriggerCode | null;
  reason: string;
  evidence: Record<string, unknown>;
};

export type EscalationCandidate = {
  escalationCode: string;
  severity: EscalationSeverity;
  source: string;
  relatedObjectType?: string;
  relatedObjectId?: string;
  message: string;
};
