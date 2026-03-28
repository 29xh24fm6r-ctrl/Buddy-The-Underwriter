/**
 * Phase 65G — SLA Policy
 *
 * Deterministic thresholds by stage and object type.
 * Uses actual canonical stage names from the lifecycle model.
 * Pure — no DB, no side effects.
 */

export type StageSlaThresholds = {
  watchHours: number;
  urgentHours: number;
  criticalHours: number;
};

export const STAGE_SLA_POLICY: Record<string, StageSlaThresholds> = {
  intake_created: {
    watchHours: 24,
    urgentHours: 48,
    criticalHours: 72,
  },
  docs_requested: {
    watchHours: 48,
    urgentHours: 96,
    criticalHours: 168,
  },
  docs_in_progress: {
    watchHours: 48,
    urgentHours: 96,
    criticalHours: 168,
  },
  docs_satisfied: {
    watchHours: 24,
    urgentHours: 48,
    criticalHours: 72,
  },
  underwrite_ready: {
    watchHours: 8,
    urgentHours: 24,
    criticalHours: 48,
  },
  underwrite_in_progress: {
    watchHours: 24,
    urgentHours: 48,
    criticalHours: 96,
  },
  committee_ready: {
    watchHours: 24,
    urgentHours: 48,
    criticalHours: 96,
  },
  committee_decisioned: {
    watchHours: 24,
    urgentHours: 48,
    criticalHours: 72,
  },
  closing_in_progress: {
    watchHours: 48,
    urgentHours: 96,
    criticalHours: 168,
  },
  closed: {
    watchHours: 999999,
    urgentHours: 999999,
    criticalHours: 999999,
  },
  workout: {
    watchHours: 999999,
    urgentHours: 999999,
    criticalHours: 999999,
  },
};

export const OBJECT_SLA_POLICY = {
  primaryAction: {
    criticalActionStaleHours: 24,
    highActionStaleHours: 48,
    normalActionStaleHours: 72,
  },
  borrowerCampaign: {
    overdueHours: 72,
    escalationAfterReminderCount: 2,
  },
  uploadsWaitingReview: {
    watchHours: 24,
    urgentHours: 48,
  },
  memoGap: {
    watchHours: 24,
    urgentHours: 48,
  },
} as const;

/**
 * Get SLA thresholds for a given stage, with safe defaults.
 */
export function getStageSla(stage: string): StageSlaThresholds {
  return STAGE_SLA_POLICY[stage] ?? {
    watchHours: 48,
    urgentHours: 96,
    criticalHours: 168,
  };
}
