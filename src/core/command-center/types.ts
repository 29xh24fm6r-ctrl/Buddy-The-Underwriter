/**
 * Phase 65H — Banker Work Queue & Command Center Types
 *
 * The command center does not invent work.
 * It renders and operates on governed outputs from existing layers:
 * canonicalState -> explanation -> nextActions -> tempo -> escalations -> queue items
 *
 * No Omega dependency. No client-side synthesis of urgency or blocking party.
 */

import type { BuddyActionCode, BuddyActionPriority } from "@/core/actions/types";
import type { DealUrgencyBucket, DealAgingSnapshot } from "@/core/sla/types";

// ── Queue Domain ────────────────────────────────────────────────────────

export type QueueDomain =
  | "documents"
  | "borrower"
  | "readiness"
  | "builder"
  | "underwriting"
  | "memo"
  | "pricing"
  | "committee"
  | "closing"
  | "post_close"
  | "general";

// ── Blocking Party ──────────────────────────────────────────────────────

export type BlockingParty =
  | "banker"
  | "borrower"
  | "buddy"
  | "mixed"
  | "unknown";

// ── Queue Actionability ─────────────────────────────────────────────────

export type QueueActionability =
  | "execute_now"
  | "open_panel"
  | "review_required"
  | "waiting_on_borrower"
  | "monitor_only";

// ── Queue Reason Code ───────────────────────────────────────────────────

export type QueueReasonCode =
  | "critical_stage_overdue"
  | "critical_primary_action_stale"
  | "borrower_reminders_exhausted"
  | "borrower_items_overdue"
  | "uploads_waiting_review"
  | "readiness_blocked"
  | "builder_incomplete"
  | "memo_gap_aging"
  | "pricing_waiting"
  | "committee_ready"
  | "closing_stalled"
  | "post_close_reporting_overdue"
  | "post_close_review_backlog"
  | "annual_review_due"
  | "renewal_prep_due"
  | "monitoring_exception_open"
  | "healthy_monitoring";

// ── Banker Queue Item ───────────────────────────────────────────────────

export type BankerQueueItem = {
  dealId: string;
  dealName: string;
  borrowerName: string | null;
  canonicalStage: string;
  urgencyBucket: DealUrgencyBucket;
  urgencyScore: number;
  queueDomain: QueueDomain;
  queueReasonCode: QueueReasonCode;
  queueReasonLabel: string;
  queueReasonDescription: string;
  blockingParty: BlockingParty;
  primaryActionCode: BuddyActionCode | null;
  primaryActionLabel: string | null;
  primaryActionPriority: BuddyActionPriority | null;
  primaryActionAgeHours: number | null;
  isActionExecutable: boolean;
  actionability: QueueActionability;
  href: string | null;
  activeEscalationCount: number;
  borrowerOverdueCount: number;
  reviewBacklogCount: number;
  latestActivityAt: string | null;
  changedSinceViewed: boolean;
};

// ── Command Center Summary ──────────────────────────────────────────────

export type CommandCenterSummary = {
  totalDeals: number;
  criticalCount: number;
  urgentCount: number;
  borrowerWaitingOnBankCount: number;
  bankWaitingOnBorrowerCount: number;
  autoAdvancedTodayCount: number;
  stalePrimaryActionCount: number;
};

// ── Queue Surface ───────────────────────────────────────────────────────

export type CommandCenterSurface = {
  summary: CommandCenterSummary;
  items: BankerQueueItem[];
  computedAt: string;
};

// ── Queue Item Derivation Input ─────────────────────────────────────────

export type QueueItemDerivationInput = {
  dealId: string;
  dealName: string;
  borrowerName: string | null;
  canonicalStage: string;
  blockerCodes: string[];
  primaryActionCode: BuddyActionCode | null;
  primaryActionLabel: string | null;
  primaryActionPriority: BuddyActionPriority | null;
  isActionExecutable: boolean;
  agingSnapshot: DealAgingSnapshot;
  borrowerCampaignStatus: string | null;
  borrowerOverdueCount: number;
  borrowerRemindersExhausted: boolean;
  reviewBacklogCount: number;
  activeEscalationCount: number;
  latestActivityAt: string | null;
  changedSinceViewed: boolean;
};

// ── Filters ─────────────────────────────────────────────────────────────

export type CommandCenterFilters = {
  urgency?: DealUrgencyBucket;
  domain?: QueueDomain;
  blockingParty?: BlockingParty;
  actionability?: QueueActionability;
  changedSinceViewed?: boolean;
};
