/**
 * Banker Command Center — Adapter from existing banker queue rows
 *
 * Maps the existing canonical `BankerQueueItem` (from the core command-center
 * queue surface) into the new `BankerCommandCenterQueueItem` shape, then
 * assembles a `BankerCommandCenterViewModel` for the intelligence overview.
 *
 * Spec: 15P / Spec 12 — Banker Command Center Integration & Visual Migration
 *
 * Rules:
 * - Real state only — never invents borrower readiness, activity timestamps,
 *   SLA durations, or approval signals.
 * - Conservative fallback when borrower-intelligence isn't loaded for a deal:
 *   queueCategory defaults to "monitoring", borrower-side labels fall back to
 *   "Borrower intelligence not available yet".
 * - Pure function, deterministic, no DB or network calls.
 * - No internal enum names leak into rendered copy.
 */

import type {
  BankerQueueItem as CoreBankerQueueItem,
  BlockingParty,
  QueueReasonCode,
} from "@/core/command-center/types";
import {
  assembleBankerCommandCenterFromQueueItems,
  type BankerCommandCenterQueueItem,
  type BankerCommandCenterQueueCategory,
  type BankerCommandCenterPriorityBand,
  type BankerCommandCenterStalenessLabel,
  type BankerCommandCenterViewModel,
} from "@/lib/banker/buildBankerCommandCenterViewModel";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type BankerCommandCenterFromDealsInput = {
  /**
   * Existing banker queue items from the canonical queue API. Each row stays
   * represented — no deal is dropped, even when borrower intelligence is
   * unavailable.
   */
  deals: CoreBankerQueueItem[];
  /**
   * Optional ISO timestamp used as "now" for staleness derivation. When
   * omitted, no staleness or days-since-activity signals are emitted.
   */
  evaluatedAt?: string;
  /** Default 7 — days before a non-blocked, non-ready deal is considered stalled */
  staleDaysThreshold?: number;
  /** Default 7 — days window for recently-active inclusion */
  recentlyActiveDaysWindow?: number;
  /** Default 8 — cap on recently-active rows */
  maxRecentlyActive?: number;
};

// ---------------------------------------------------------------------------
// Fallback copy
// ---------------------------------------------------------------------------

const FALLBACK_READINESS_LABEL = "Borrower intelligence not available yet";
const FALLBACK_TRUST_LABEL = "Not ready for review yet";

// ---------------------------------------------------------------------------
// Category / priority derivation from existing core fields
// ---------------------------------------------------------------------------

function deriveQueueCategory(deal: CoreBankerQueueItem): BankerCommandCenterQueueCategory {
  // Stalled-style queue reason codes that warrant the "stalled" bucket.
  const STALLED_REASONS: QueueReasonCode[] = [
    "closing_stalled",
    "workout_stalled",
    "borrower_reminders_exhausted",
    "borrower_items_overdue",
  ];
  if (STALLED_REASONS.includes(deal.queueReasonCode)) return "stalled";

  // Reason-code-driven categorization first (most operationally specific).
  switch (deal.queueReasonCode) {
    case "uploads_waiting_review":
    case "memo_gap_aging":
    case "committee_ready":
    case "post_close_review_backlog":
    case "annual_review_under_review":
    case "renewal_under_review":
    case "annual_review_ready":
    case "renewal_ready":
      return "ready_for_banker_review";
    case "readiness_blocked":
    case "review_exception_open":
    case "monitoring_exception_open":
    case "watchlist_active":
    case "workout_active":
    case "workout_action_overdue":
      return "operationally_blocked";
    case "pricing_waiting":
    case "critical_stage_overdue":
    case "critical_primary_action_stale":
      return "banker_action_required";
    case "annual_review_collecting":
    case "renewal_collecting":
    case "annual_review_due":
    case "renewal_prep_due":
      return "borrower_action_required";
    case "healthy_monitoring":
      return "monitoring";
    default:
      break;
  }

  // Blocking-party fallback when reason code didn't pin a category.
  switch (deal.blockingParty) {
    case "borrower":
      return "borrower_action_required";
    case "banker":
      return "banker_action_required";
    case "buddy":
      return "ready_for_banker_review";
    case "mixed":
      return "needs_clarification";
    case "unknown":
    default:
      return "monitoring";
  }
}

const URGENCY_TO_PRIORITY: Record<
  CoreBankerQueueItem["urgencyBucket"],
  BankerCommandCenterPriorityBand
> = {
  critical: "immediate_attention",
  urgent: "active_review",
  watch: "progressing",
  healthy: "monitoring",
};

function derivePriorityBand(deal: CoreBankerQueueItem): BankerCommandCenterPriorityBand {
  // Blocking party can override bucket → keep "waiting on borrower" pressure
  // visible even when the bucket says urgent.
  if (deal.blockingParty === "borrower" && deal.urgencyBucket !== "critical") {
    return "waiting_on_borrower";
  }
  return URGENCY_TO_PRIORITY[deal.urgencyBucket] ?? "monitoring";
}

// ---------------------------------------------------------------------------
// Staleness derivation
// ---------------------------------------------------------------------------

function parseIsoDay(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function diffDays(now: string | undefined, then: string | null | undefined): number | null {
  const a = parseIsoDay(now);
  const b = parseIsoDay(then);
  if (a === null || b === null) return null;
  return Math.max(0, a - b);
}

function deriveStaleness(opts: {
  category: BankerCommandCenterQueueCategory;
  daysSinceLastActivity: number | null;
  staleDaysThreshold: number;
}): BankerCommandCenterStalenessLabel | null {
  const { category, daysSinceLastActivity, staleDaysThreshold } = opts;
  if (daysSinceLastActivity === null) return null;
  if (daysSinceLastActivity <= 2) return "recently_active";
  if (
    category === "ready_for_banker_review" ||
    category === "banker_action_required"
  ) {
    return "needs_review";
  }
  if (daysSinceLastActivity >= staleDaysThreshold) return "stalled";
  if (category === "borrower_action_required" || category === "monitoring") {
    return "waiting_for_follow_up";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Waiting-on / next-best-action label translation
// ---------------------------------------------------------------------------

function waitingOnLabelFor(party: BlockingParty): string {
  switch (party) {
    case "borrower":
      return "Waiting on borrower";
    case "banker":
      return "Waiting on banker";
    case "buddy":
      return "Queued for review";
    case "mixed":
      return "Awaiting clarification";
    case "unknown":
    default:
      return "No active wait";
  }
}

function nextBestActionLabelFor(deal: CoreBankerQueueItem): string {
  const primary = deal.primaryActionLabel?.trim();
  if (primary) return primary;
  const reason = deal.queueReasonLabel?.trim();
  if (reason) return reason;
  switch (deal.blockingParty) {
    case "borrower":
      return "Wait for borrower";
    case "banker":
      return "Open deal workspace";
    case "buddy":
      return "Open for review";
    case "mixed":
      return "Resolve clarification items";
    default:
      return "No action needed right now";
  }
}

// ---------------------------------------------------------------------------
// Mapping a single core queue row → command-center queue item
// ---------------------------------------------------------------------------

function mapToCommandCenterItem(
  deal: CoreBankerQueueItem,
  opts: { evaluatedAt?: string; staleDaysThreshold: number },
): BankerCommandCenterQueueItem {
  const initialCategory = deriveQueueCategory(deal);
  const priorityBand = derivePriorityBand(deal);

  const lastActivityAt =
    typeof deal.latestActivityAt === "string" && deal.latestActivityAt.length > 0
      ? deal.latestActivityAt
      : undefined;
  const days = opts.evaluatedAt && lastActivityAt
    ? diffDays(opts.evaluatedAt, lastActivityAt)
    : null;
  const staleness = opts.evaluatedAt && lastActivityAt
    ? deriveStaleness({
        category: initialCategory,
        daysSinceLastActivity: days,
        staleDaysThreshold: opts.staleDaysThreshold,
      })
    : null;

  let category = initialCategory;
  // If the deal is operationally blocked at the reason-code level, "stalled"
  // is the more honest bucket only when the activity is truly old. Otherwise
  // keep the reason-code's stronger signal.
  if (
    staleness === "stalled" &&
    (category === "borrower_action_required" ||
      category === "monitoring")
  ) {
    category = "stalled";
  }

  const item: BankerCommandCenterQueueItem = {
    dealId: deal.dealId,
    borrowerLabel: deal.dealName || deal.borrowerName || `Deal ${deal.dealId.slice(0, 8)}`,
    queueCategory: category,
    priorityBand,
    readinessLabel: FALLBACK_READINESS_LABEL,
    waitingOnLabel: waitingOnLabelFor(deal.blockingParty),
    nextBestActionLabel: nextBestActionLabelFor(deal),
    trustReviewLabel: FALLBACK_TRUST_LABEL,
  };

  // Real counts (operational, not borrower-readiness invention):
  if (deal.borrowerOverdueCount > 0) {
    item.requiredDocumentsRemaining = deal.borrowerOverdueCount;
  }
  if (deal.reviewBacklogCount > 0) {
    // Treat backlog items as flagged for banker attention.
    item.needsAttentionCount = deal.reviewBacklogCount;
  }

  const reasonDesc = deal.queueReasonDescription?.trim() || deal.queueReasonLabel?.trim();
  if (reasonDesc) item.topBlocker = reasonDesc;

  if (lastActivityAt) item.lastActivityAt = lastActivityAt;
  if (staleness) item.staleness = staleness;
  if (days !== null && opts.evaluatedAt && lastActivityAt) {
    item.daysSinceLastActivity = days;
  }

  if (deal.href && deal.href.length > 0) item.href = deal.href;

  return item;
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

export function buildBankerCommandCenterFromDeals(
  input: BankerCommandCenterFromDealsInput,
): BankerCommandCenterViewModel {
  const staleDaysThreshold = Math.max(1, input.staleDaysThreshold ?? 7);

  // Stable input ordering by dealId so downstream sort is deterministic.
  const sortedDeals = [...input.deals].sort((a, b) =>
    a.dealId.localeCompare(b.dealId),
  );

  const items = sortedDeals.map((deal) =>
    mapToCommandCenterItem(deal, {
      evaluatedAt: input.evaluatedAt,
      staleDaysThreshold,
    }),
  );

  return assembleBankerCommandCenterFromQueueItems(items, {
    evaluatedAt: input.evaluatedAt,
    recentlyActiveDaysWindow: input.recentlyActiveDaysWindow,
    maxRecentlyActive: input.maxRecentlyActive,
  });
}

// Re-export the fallback constants so tests + UI can refer to them
// instead of hardcoding the same strings.
export const BANKER_COMMAND_CENTER_FROM_DEALS_FALLBACKS = {
  readinessLabel: FALLBACK_READINESS_LABEL,
  trustReviewLabel: FALLBACK_TRUST_LABEL,
} as const;
