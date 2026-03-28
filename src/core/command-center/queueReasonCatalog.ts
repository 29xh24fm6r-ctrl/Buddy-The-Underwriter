/**
 * Phase 65H — Queue Reason Catalog
 *
 * Deterministic precedence order for queue reason assignment.
 * Higher index = lower priority. First match wins.
 */

import type { QueueDomain, QueueReasonCode } from "./types";

export type QueueReasonEntry = {
  code: QueueReasonCode;
  label: string;
  description: string;
  domain: QueueDomain;
  precedence: number;
};

/**
 * Queue reason catalog in strict precedence order.
 * Lower precedence number = higher priority.
 */
export const QUEUE_REASON_CATALOG: QueueReasonEntry[] = [
  {
    code: "critical_stage_overdue",
    label: "Stage SLA breached",
    description: "Deal has exceeded the critical time threshold for its current stage.",
    domain: "general",
    precedence: 1,
  },
  {
    code: "critical_primary_action_stale",
    label: "Primary action overdue",
    description: "The deal's critical primary action has not been executed within the expected timeframe.",
    domain: "general",
    precedence: 2,
  },
  {
    code: "borrower_reminders_exhausted",
    label: "Borrower reminders exhausted",
    description: "All automated reminders have been sent but the borrower has not responded.",
    domain: "borrower",
    precedence: 3,
  },
  {
    code: "borrower_items_overdue",
    label: "Borrower items overdue",
    description: "Borrower has outstanding overdue items in an active campaign.",
    domain: "borrower",
    precedence: 4,
  },
  {
    code: "uploads_waiting_review",
    label: "Uploads awaiting review",
    description: "Borrower has submitted documents that need banker review.",
    domain: "documents",
    precedence: 5,
  },
  {
    code: "readiness_blocked",
    label: "Readiness blockers",
    description: "Unresolved readiness blockers are preventing deal advancement.",
    domain: "readiness",
    precedence: 6,
  },
  {
    code: "builder_incomplete",
    label: "Builder incomplete",
    description: "Required builder items are not yet complete.",
    domain: "builder",
    precedence: 7,
  },
  {
    code: "memo_gap_aging",
    label: "Memo gaps aging",
    description: "Credit memo has unresolved gaps that are aging.",
    domain: "memo",
    precedence: 8,
  },
  {
    code: "pricing_waiting",
    label: "Pricing incomplete",
    description: "Pricing assumptions or decisions are missing.",
    domain: "pricing",
    precedence: 9,
  },
  {
    code: "committee_ready",
    label: "Committee ready",
    description: "Deal is ready for committee review and awaiting banker action.",
    domain: "committee",
    precedence: 10,
  },
  {
    code: "closing_stalled",
    label: "Closing stalled",
    description: "Closing process has stalled and needs attention.",
    domain: "closing",
    precedence: 11,
  },
  {
    code: "post_close_reporting_overdue",
    label: "Reporting overdue",
    description: "Post-close reporting obligation is overdue.",
    domain: "post_close",
    precedence: 12,
  },
  {
    code: "post_close_review_backlog",
    label: "Post-close review backlog",
    description: "Submitted monitoring items await banker review.",
    domain: "post_close",
    precedence: 13,
  },
  {
    code: "monitoring_exception_open",
    label: "Monitoring exception",
    description: "An open monitoring exception requires attention.",
    domain: "post_close",
    precedence: 14,
  },
  {
    code: "annual_review_due",
    label: "Annual review due",
    description: "Annual review is due and should be started.",
    domain: "post_close",
    precedence: 15,
  },
  {
    code: "annual_review_collecting",
    label: "Annual review — collecting",
    description: "Annual review is collecting borrower documents.",
    domain: "post_close",
    precedence: 16,
  },
  {
    code: "annual_review_under_review",
    label: "Annual review — under review",
    description: "Annual review is under banker review.",
    domain: "post_close",
    precedence: 17,
  },
  {
    code: "annual_review_ready",
    label: "Annual review — ready",
    description: "Annual review is ready for completion.",
    domain: "post_close",
    precedence: 18,
  },
  {
    code: "renewal_prep_due",
    label: "Renewal prep due",
    description: "Loan renewal prep should begin based on maturity timeline.",
    domain: "post_close",
    precedence: 19,
  },
  {
    code: "renewal_collecting",
    label: "Renewal — collecting",
    description: "Renewal case is collecting borrower documents.",
    domain: "post_close",
    precedence: 20,
  },
  {
    code: "renewal_under_review",
    label: "Renewal — under review",
    description: "Renewal case is under banker review.",
    domain: "post_close",
    precedence: 21,
  },
  {
    code: "renewal_ready",
    label: "Renewal — ready",
    description: "Renewal case is ready for decision.",
    domain: "post_close",
    precedence: 22,
  },
  {
    code: "review_exception_open",
    label: "Review exception open",
    description: "An open exception in a review or renewal case needs attention.",
    domain: "post_close",
    precedence: 23,
  },
  {
    code: "monitoring_exception_open",
    label: "Monitoring exception",
    description: "An open monitoring exception requires attention.",
    domain: "post_close",
    precedence: 24,
  },
  {
    code: "watchlist_active",
    label: "On watchlist",
    description: "Deal is on the watchlist and requires monitoring.",
    domain: "post_close",
    precedence: 25,
  },
  {
    code: "workout_active",
    label: "In workout",
    description: "Deal is in active workout / special assets.",
    domain: "post_close",
    precedence: 26,
  },
  {
    code: "workout_action_overdue",
    label: "Workout action overdue",
    description: "A workout action item is past due.",
    domain: "post_close",
    precedence: 27,
  },
  {
    code: "workout_stalled",
    label: "Workout stalled",
    description: "No material workout activity in extended period.",
    domain: "post_close",
    precedence: 28,
  },
  {
    code: "healthy_monitoring",
    label: "Healthy — monitoring",
    description: "Deal is progressing normally. No immediate action required.",
    domain: "general",
    precedence: 29,
  },
];

const catalogByCode = new Map(
  QUEUE_REASON_CATALOG.map((r) => [r.code, r]),
);

export function getQueueReasonEntry(code: QueueReasonCode): QueueReasonEntry {
  return catalogByCode.get(code) ?? QUEUE_REASON_CATALOG[QUEUE_REASON_CATALOG.length - 1];
}
