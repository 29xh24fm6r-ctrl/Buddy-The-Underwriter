/**
 * Phase 65H — Queue Reason → Href Mapping
 *
 * Maps queue reason codes to the relevant deal page/panel.
 * Pure function.
 */

import type { QueueReasonCode } from "./types";

const REASON_TO_PATH: Record<QueueReasonCode, string> = {
  critical_stage_overdue: "",
  critical_primary_action_stale: "",
  borrower_reminders_exhausted: "/borrower",
  borrower_items_overdue: "/borrower",
  uploads_waiting_review: "/documents",
  readiness_blocked: "/builder",
  builder_incomplete: "/builder",
  memo_gap_aging: "/credit-memo",
  pricing_waiting: "/pricing",
  committee_ready: "/committee",
  closing_stalled: "/closing",
  healthy_monitoring: "",
};

export function mapQueueReasonToHref(
  dealId: string,
  reasonCode: QueueReasonCode,
): string {
  const suffix = REASON_TO_PATH[reasonCode] ?? "";
  return `/deals/${dealId}${suffix}`;
}
