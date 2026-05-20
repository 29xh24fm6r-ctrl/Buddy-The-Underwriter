/**
 * Banker Command Center — View Model Builder
 *
 * Deterministic, pure-function synthesizer that compresses many borrower
 * operational-continuity view models into a single banker-facing command
 * center: workload summary, intelligent queue sections, recently-active list.
 *
 * Spec: 15O / Spec 11 — Banker Command Center
 *
 * Rules:
 * - Pure function, no DB or network calls
 * - Operational prioritization only — never credit, approval, or risk scoring
 * - Real state only — no fake SLA, fabricated urgency, or invented timestamps
 * - Banker-operational copy only — no internal enums or approval language
 * - Deterministic ordering for testability
 * - Safe fallback for empty / minimal pipelines
 *
 * Note: types are namespaced with the `BankerCommandCenter` prefix to avoid
 * colliding with the existing core/command-center `BankerQueueItem` shape,
 * which is unrelated to this spec.
 */

import type {
  BorrowerOperationalContinuityViewModel,
  BorrowerOperationalHandoffState,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import { BORROWER_OPERATIONAL_HANDOFF_STATE_LABELS } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BankerCommandCenterQueueCategory =
  | "banker_action_required"
  | "borrower_action_required"
  | "ready_for_banker_review"
  | "ready_for_submission_prep"
  | "needs_clarification"
  | "stalled"
  | "operationally_blocked"
  | "monitoring";

export type BankerCommandCenterPriorityBand =
  | "immediate_attention"
  | "active_review"
  | "progressing"
  | "waiting_on_borrower"
  | "monitoring";

export type BankerCommandCenterStalenessLabel =
  | "recently_active"
  | "waiting_for_follow_up"
  | "stalled"
  | "needs_review";

export type BankerCommandCenterQueueItem = {
  dealId: string;
  borrowerLabel: string;
  queueCategory: BankerCommandCenterQueueCategory;
  priorityBand: BankerCommandCenterPriorityBand;
  readinessLabel: string;
  waitingOnLabel: string;
  topBlocker?: string;
  nextBestActionLabel: string;
  recentActivitySummary?: string;
  submissionReadinessLabel?: string;
  trustReviewLabel?: string;
  requiredDocumentsRemaining?: number;
  needsAttentionCount?: number;
  lastActivityAt?: string;
  staleness?: BankerCommandCenterStalenessLabel;
  daysSinceLastActivity?: number;
  href?: string;
};

export type BankerCommandCenterWorkloadSummary = {
  totalDeals: number;
  bankerActionRequired: number;
  borrowerActionRequired: number;
  readyForSubmissionPrep: number;
  stalledDeals: number;
  operationallyBlocked: number;
  unresolvedAttentionItems: number;
};

export type BankerCommandCenterSection = {
  id: BankerCommandCenterQueueCategory;
  label: string;
  items: BankerCommandCenterQueueItem[];
};

export type BankerCommandCenterViewModel = {
  summary: BankerCommandCenterWorkloadSummary;
  sections: BankerCommandCenterSection[];
  recentlyActive: BankerCommandCenterQueueItem[];
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type BankerCommandCenterDealInput = {
  dealId: string;
  borrowerLabel: string;
  continuity: BorrowerOperationalContinuityViewModel;
  /** Optional href to deal workspace */
  href?: string | null;
  /** Optional, real-only ISO timestamp of last borrower activity */
  lastActivityAt?: string | null;
  /** Optional short, banker-safe recent activity summary */
  recentActivitySummary?: string | null;
  /** Optional banker-safe top blocker line (e.g. "Tax return missing") */
  topBlocker?: string | null;
};

export type BankerCommandCenterInput = {
  deals: BankerCommandCenterDealInput[];
  /**
   * Optional ISO timestamp used as "now" for staleness derivation.
   * When omitted, no staleness or days-since-activity signals are emitted.
   */
  evaluatedAt?: string;
  /** Default 7 — number of days before a non-blocked, non-ready deal is "stalled" */
  staleDaysThreshold?: number;
  /** Default 7 — window of days for recentlyActive inclusion */
  recentlyActiveDaysWindow?: number;
  /** Default 8 — cap for recentlyActive */
  maxRecentlyActive?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIsoDay(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function diffDays(now: string | undefined, then: string | undefined): number | null {
  const a = parseIsoDay(now);
  const b = parseIsoDay(then);
  if (a === null || b === null) return null;
  return Math.max(0, a - b);
}

// ---------------------------------------------------------------------------
// Category and priority derivation
// ---------------------------------------------------------------------------

const QUEUE_CATEGORY_BY_HANDOFF: Record<
  BorrowerOperationalHandoffState,
  BankerCommandCenterQueueCategory
> = {
  borrower_blocked: "operationally_blocked",
  needs_clarification: "needs_clarification",
  ready_for_submission_prep: "ready_for_submission_prep",
  ready_for_banker_review: "ready_for_banker_review",
  waiting_on_banker: "banker_action_required",
  waiting_on_borrower: "borrower_action_required",
  borrower_active: "monitoring",
  borrower_starting: "monitoring",
};

const SECTION_LABELS: Record<BankerCommandCenterQueueCategory, string> = {
  banker_action_required: "Needs Banker Action",
  borrower_action_required: "Waiting on Borrower",
  ready_for_banker_review: "Ready for Banker Review",
  ready_for_submission_prep: "Ready for Submission Prep",
  needs_clarification: "Needs Clarification",
  stalled: "Stalled",
  operationally_blocked: "Operationally Blocked",
  monitoring: "Monitoring",
};

const SECTION_ORDER: BankerCommandCenterQueueCategory[] = [
  "operationally_blocked",
  "needs_clarification",
  "banker_action_required",
  "ready_for_banker_review",
  "ready_for_submission_prep",
  "borrower_action_required",
  "stalled",
  "monitoring",
];

function derivePriorityBand(
  handoffState: BorrowerOperationalHandoffState,
): BankerCommandCenterPriorityBand {
  switch (handoffState) {
    case "borrower_blocked":
    case "needs_clarification":
      return "immediate_attention";
    case "ready_for_submission_prep":
    case "ready_for_banker_review":
    case "waiting_on_banker":
      return "active_review";
    case "borrower_active":
      return "progressing";
    case "waiting_on_borrower":
      return "waiting_on_borrower";
    case "borrower_starting":
      return "monitoring";
  }
}

const PRIORITY_RANK: Record<BankerCommandCenterPriorityBand, number> = {
  immediate_attention: 0,
  active_review: 1,
  progressing: 2,
  waiting_on_borrower: 3,
  monitoring: 4,
};

// ---------------------------------------------------------------------------
// Staleness derivation
// ---------------------------------------------------------------------------

function deriveStaleness(opts: {
  handoffState: BorrowerOperationalHandoffState;
  daysSinceLastActivity: number | null;
  staleDaysThreshold: number;
}): BankerCommandCenterStalenessLabel | null {
  const { handoffState, daysSinceLastActivity, staleDaysThreshold } = opts;
  if (daysSinceLastActivity === null) return null;

  if (daysSinceLastActivity <= 2) return "recently_active";

  if (handoffState === "ready_for_banker_review" || handoffState === "waiting_on_banker") {
    return "needs_review";
  }

  if (daysSinceLastActivity >= staleDaysThreshold) {
    return handoffState === "borrower_blocked" ? "stalled" : "stalled";
  }

  if (handoffState === "waiting_on_borrower" || handoffState === "borrower_active") {
    return "waiting_for_follow_up";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Queue item builder
// ---------------------------------------------------------------------------

function buildQueueItem(
  deal: BankerCommandCenterDealInput,
  opts: { evaluatedAt?: string; staleDaysThreshold: number },
): BankerCommandCenterQueueItem {
  const continuity = deal.continuity;
  const handoffState = continuity.handoffState;
  const initialCategory = QUEUE_CATEGORY_BY_HANDOFF[handoffState];

  const lastActivityAt = trimOrNull(deal.lastActivityAt) ?? undefined;
  const days =
    opts.evaluatedAt && lastActivityAt
      ? diffDays(opts.evaluatedAt, lastActivityAt)
      : null;
  const staleness =
    opts.evaluatedAt && lastActivityAt
      ? deriveStaleness({
          handoffState,
          daysSinceLastActivity: days,
          staleDaysThreshold: opts.staleDaysThreshold,
        })
      : null;

  // Stalled detection bumps category when warranted.
  let queueCategory = initialCategory;
  if (
    staleness === "stalled" &&
    (handoffState === "waiting_on_borrower" ||
      handoffState === "borrower_active" ||
      handoffState === "borrower_starting")
  ) {
    queueCategory = "stalled";
  }

  const priorityBand = derivePriorityBand(handoffState);

  const item: BankerCommandCenterQueueItem = {
    dealId: deal.dealId,
    borrowerLabel: deal.borrowerLabel,
    queueCategory,
    priorityBand,
    readinessLabel: continuity.momentum.submissionReadinessLabel,
    waitingOnLabel: continuity.waitingOnLabel,
    nextBestActionLabel: continuity.nextBestAction.label,
    submissionReadinessLabel: continuity.momentum.submissionReadinessLabel,
    trustReviewLabel: continuity.momentum.trustReviewLabel,
    requiredDocumentsRemaining: continuity.momentum.requiredDocumentsRemaining,
    needsAttentionCount: continuity.momentum.needsAttentionCount,
  };

  const topBlocker = trimOrNull(deal.topBlocker);
  if (topBlocker) item.topBlocker = topBlocker;

  const recentActivitySummary = trimOrNull(deal.recentActivitySummary);
  if (recentActivitySummary) item.recentActivitySummary = recentActivitySummary;

  if (lastActivityAt) item.lastActivityAt = lastActivityAt;
  if (staleness) item.staleness = staleness;
  if (days !== null && opts.evaluatedAt && lastActivityAt)
    item.daysSinceLastActivity = days;

  const href = trimOrNull(deal.href);
  if (href) item.href = href;

  return item;
}

// ---------------------------------------------------------------------------
// Sorting and grouping
// ---------------------------------------------------------------------------

function compareQueueItems(
  a: BankerCommandCenterQueueItem,
  b: BankerCommandCenterQueueItem,
): number {
  const pa = PRIORITY_RANK[a.priorityBand];
  const pb = PRIORITY_RANK[b.priorityBand];
  if (pa !== pb) return pa - pb;

  // Within the same priority band, prefer the deal whose blocker is heavier:
  // attention items first, then required-remaining, then borrower activity recency
  const attentionA = a.needsAttentionCount ?? 0;
  const attentionB = b.needsAttentionCount ?? 0;
  if (attentionA !== attentionB) return attentionB - attentionA;

  const remainingA = a.requiredDocumentsRemaining ?? 0;
  const remainingB = b.requiredDocumentsRemaining ?? 0;
  if (remainingA !== remainingB) return remainingB - remainingA;

  // Newer activity wins (descending) when both have timestamps.
  if (a.lastActivityAt && b.lastActivityAt) {
    if (a.lastActivityAt < b.lastActivityAt) return 1;
    if (a.lastActivityAt > b.lastActivityAt) return -1;
  } else if (a.lastActivityAt && !b.lastActivityAt) {
    return -1;
  } else if (!a.lastActivityAt && b.lastActivityAt) {
    return 1;
  }

  // Finally, fall back to dealId for deterministic ordering.
  return a.dealId.localeCompare(b.dealId);
}

function groupBySection(
  items: BankerCommandCenterQueueItem[],
): BankerCommandCenterSection[] {
  const buckets = new Map<BankerCommandCenterQueueCategory, BankerCommandCenterQueueItem[]>();
  for (const id of SECTION_ORDER) buckets.set(id, []);
  for (const item of items) {
    const list = buckets.get(item.queueCategory);
    if (list) list.push(item);
  }
  const sections: BankerCommandCenterSection[] = [];
  for (const id of SECTION_ORDER) {
    const list = buckets.get(id) ?? [];
    if (list.length === 0) continue;
    list.sort(compareQueueItems);
    sections.push({ id, label: SECTION_LABELS[id], items: list });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Workload summary
// ---------------------------------------------------------------------------

function buildSummary(
  items: BankerCommandCenterQueueItem[],
): BankerCommandCenterWorkloadSummary {
  let bankerActionRequired = 0;
  let borrowerActionRequired = 0;
  let readyForSubmissionPrep = 0;
  let stalledDeals = 0;
  let operationallyBlocked = 0;
  let unresolvedAttentionItems = 0;

  for (const item of items) {
    switch (item.queueCategory) {
      case "banker_action_required":
      case "ready_for_banker_review":
      case "needs_clarification":
        bankerActionRequired += 1;
        break;
      case "borrower_action_required":
        borrowerActionRequired += 1;
        break;
      case "ready_for_submission_prep":
        readyForSubmissionPrep += 1;
        bankerActionRequired += 1;
        break;
      case "stalled":
        stalledDeals += 1;
        break;
      case "operationally_blocked":
        operationallyBlocked += 1;
        bankerActionRequired += 1;
        break;
      case "monitoring":
        // not part of any summary bucket
        break;
    }
    unresolvedAttentionItems += item.needsAttentionCount ?? 0;
  }

  return {
    totalDeals: items.length,
    bankerActionRequired,
    borrowerActionRequired,
    readyForSubmissionPrep,
    stalledDeals,
    operationallyBlocked,
    unresolvedAttentionItems,
  };
}

// ---------------------------------------------------------------------------
// Recently active
// ---------------------------------------------------------------------------

function buildRecentlyActive(
  items: BankerCommandCenterQueueItem[],
  opts: {
    evaluatedAt?: string;
    recentlyActiveDaysWindow: number;
    maxRecentlyActive: number;
  },
): BankerCommandCenterQueueItem[] {
  if (!opts.evaluatedAt) return [];
  const eligible: BankerCommandCenterQueueItem[] = [];
  for (const item of items) {
    if (!item.lastActivityAt) continue;
    const days = diffDays(opts.evaluatedAt, item.lastActivityAt);
    if (days === null) continue;
    if (days <= opts.recentlyActiveDaysWindow) eligible.push(item);
  }
  eligible.sort((a, b) => {
    if (a.lastActivityAt && b.lastActivityAt) {
      if (a.lastActivityAt < b.lastActivityAt) return 1;
      if (a.lastActivityAt > b.lastActivityAt) return -1;
    }
    return a.dealId.localeCompare(b.dealId);
  });
  return eligible.slice(0, opts.maxRecentlyActive);
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBankerCommandCenterViewModel(
  input: BankerCommandCenterInput,
): BankerCommandCenterViewModel {
  const staleDaysThreshold = Math.max(1, input.staleDaysThreshold ?? 7);
  const recentlyActiveDaysWindow = Math.max(
    1,
    input.recentlyActiveDaysWindow ?? 7,
  );
  const maxRecentlyActive = Math.max(0, input.maxRecentlyActive ?? 8);

  // Stable input ordering (by dealId) before derivation so downstream sorts
  // are deterministic regardless of caller ordering.
  const sortedDeals = [...input.deals].sort((a, b) =>
    a.dealId.localeCompare(b.dealId),
  );

  const items = sortedDeals.map((deal) =>
    buildQueueItem(deal, {
      evaluatedAt: input.evaluatedAt,
      staleDaysThreshold,
    }),
  );

  return assembleBankerCommandCenterFromQueueItems(items, {
    evaluatedAt: input.evaluatedAt,
    recentlyActiveDaysWindow,
    maxRecentlyActive,
  });
}

/**
 * Lower-level assembler that callers can use when they already have
 * `BankerCommandCenterQueueItem[]` (e.g. produced by an adapter that maps
 * existing core banker-queue rows into command-center items without going
 * through the continuity view model).
 */
export function assembleBankerCommandCenterFromQueueItems(
  items: BankerCommandCenterQueueItem[],
  opts: {
    evaluatedAt?: string;
    recentlyActiveDaysWindow?: number;
    maxRecentlyActive?: number;
  } = {},
): BankerCommandCenterViewModel {
  const recentlyActiveDaysWindow = Math.max(
    1,
    opts.recentlyActiveDaysWindow ?? 7,
  );
  const maxRecentlyActive = Math.max(0, opts.maxRecentlyActive ?? 8);

  const sections = groupBySection(items);
  const summary = buildSummary(items);
  const recentlyActive = buildRecentlyActive(items, {
    evaluatedAt: opts.evaluatedAt,
    recentlyActiveDaysWindow,
    maxRecentlyActive,
  });

  return { summary, sections, recentlyActive };
}

// ---------------------------------------------------------------------------
// Public labels (used by UI + tests)
// ---------------------------------------------------------------------------

export const BANKER_COMMAND_CENTER_SECTION_LABELS = SECTION_LABELS;
export const BANKER_COMMAND_CENTER_SECTION_ORDER = SECTION_ORDER;

export const BANKER_COMMAND_CENTER_PRIORITY_LABELS: Record<
  BankerCommandCenterPriorityBand,
  string
> = {
  immediate_attention: "Immediate attention",
  active_review: "Active review",
  progressing: "Progressing",
  waiting_on_borrower: "Waiting on borrower",
  monitoring: "Monitoring",
};

export const BANKER_COMMAND_CENTER_STALENESS_LABELS: Record<
  BankerCommandCenterStalenessLabel,
  string
> = {
  recently_active: "Recently active",
  waiting_for_follow_up: "Waiting for follow-up",
  stalled: "Stalled",
  needs_review: "Needs review",
};

// Re-export the handoff-state labels for callers that build UI on top of
// command-center items without pulling in the continuity module directly.
export { BORROWER_OPERATIONAL_HANDOFF_STATE_LABELS };
