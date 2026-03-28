/**
 * Phase 65I — Post-Close Monitoring OS Types
 *
 * Post-close monitoring is deterministic and evidence-based.
 * No Omega dependency. No obligation complete from message delivery alone.
 */

// ── Cadence ─────────────────────────────────────────────────────────────

export type MonitoringCadence =
  | "one_time"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual"
  | "custom";

// ── Cycle Status ────────────────────────────────────────────────────────

export type MonitoringCycleStatus =
  | "upcoming"
  | "due"
  | "overdue"
  | "submitted"
  | "under_review"
  | "completed"
  | "waived"
  | "exception_open";

// ── Exception ───────────────────────────────────────────────────────────

export type MonitoringExceptionSeverity =
  | "watch"
  | "urgent"
  | "critical";

export type MonitoringExceptionCode =
  | "reporting_overdue"
  | "borrower_nonresponse"
  | "review_backlog"
  | "covenant_certificate_missing"
  | "annual_review_overdue";

// ── Obligation Type ─────────────────────────────────────────────────────

export type MonitoringObligationType =
  | "financial_reporting"
  | "borrowing_base"
  | "covenant_certificate"
  | "tax_return"
  | "insurance"
  | "rent_roll"
  | "aging_report"
  | "annual_review"
  | "renewal_prep"
  | "custom";

// ── Program Summary ─────────────────────────────────────────────────────

export type MonitoringProgramSummary = {
  dealId: string;
  programId: string;
  programStatus: "active" | "paused" | "completed" | "cancelled";
  upcomingCount: number;
  dueCount: number;
  overdueCount: number;
  underReviewCount: number;
  openExceptionCount: number;
  nextReviewDueAt: string | null;
  nextReportingDueAt: string | null;
  nextRenewalPrepAt: string | null;
};

// ── Monitoring Queue Item ───────────────────────────────────────────────

export type MonitoringBlockingParty =
  | "borrower"
  | "banker"
  | "buddy"
  | "mixed"
  | "unknown";

export type MonitoringSeverity =
  | "healthy"
  | "watch"
  | "urgent"
  | "critical";

export type MonitoringQueueItem = {
  dealId: string;
  obligationId: string;
  cycleId: string;
  title: string;
  obligationType: MonitoringObligationType;
  dueAt: string;
  status: MonitoringCycleStatus;
  blockingParty: MonitoringBlockingParty;
  severity: MonitoringSeverity;
  borrowerCampaignId: string | null;
  changedSinceViewed: boolean;
};

// ── DB Row Types ────────────────────────────────────────────────────────

export type MonitoringProgramRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  status: string;
  loan_closed_at: string | null;
  next_review_due_at: string | null;
  next_reporting_due_at: string | null;
  next_renewal_prep_at: string | null;
  created_by: string;
  created_at: string;
};

export type MonitoringObligationRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  program_id: string;
  obligation_type: string;
  title: string;
  description: string;
  cadence: string;
  due_day: number | null;
  due_month: number | null;
  requires_borrower_submission: boolean;
  requires_banker_review: boolean;
  is_financial_reporting: boolean;
  is_covenant_related: boolean;
  is_annual_review_input: boolean;
  is_renewal_related: boolean;
  status: string;
  source: string;
  source_record_id: string | null;
  created_at: string;
};

export type MonitoringCycleRow = {
  id: string;
  obligation_id: string;
  deal_id: string;
  bank_id: string;
  cycle_start_at: string | null;
  due_at: string;
  status: string;
  borrower_campaign_id: string | null;
  submission_received_at: string | null;
  review_started_at: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type MonitoringExceptionRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  cycle_id: string | null;
  obligation_id: string | null;
  exception_code: string;
  severity: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  opened_by: string;
  resolution_note: string | null;
};
