/**
 * Phase 65H — Queue Reason Code Derivation
 *
 * Determines the single most important reason a deal appears in the queue.
 * Uses strict precedence: first match wins.
 * Pure function — no DB, no side effects.
 */

import type { QueueReasonCode } from "./types";
import type { StuckReasonCode } from "@/core/sla/types";

export type QueueReasonInput = {
  isStageOverdue: boolean;
  isPrimaryActionStale: boolean;
  primaryActionPriority: "critical" | "high" | "normal" | null;
  borrowerRemindersExhausted: boolean;
  borrowerOverdueCount: number;
  reviewBacklogCount: number;
  blockerCodes: string[];
  canonicalStage: string;
  stuckReasonCodes: StuckReasonCode[];
};

const READINESS_BLOCKERS = [
  "readiness_not_satisfied",
  "checklist_items_missing",
  "document_gaps_open",
];

const MEMO_BLOCKERS = [
  "committee_packet_missing",
  "decision_missing",
  "credit_memo_incomplete",
];

const PRICING_BLOCKERS = [
  "pricing_assumptions_required",
  "risk_pricing_not_finalized",
  "structural_pricing_missing",
  "pricing_quote_missing",
];

const BUILDER_BLOCKERS = [
  "builder_items_incomplete",
  "builder_not_started",
];

export function deriveQueueReasonCode(input: QueueReasonInput): QueueReasonCode {
  // 1. Critical stage SLA breach
  if (input.isStageOverdue) {
    return "critical_stage_overdue";
  }

  // 2. Critical stale primary action
  if (input.isPrimaryActionStale && input.primaryActionPriority === "critical") {
    return "critical_primary_action_stale";
  }

  // 3. Borrower reminders exhausted
  if (input.borrowerRemindersExhausted) {
    return "borrower_reminders_exhausted";
  }

  // 4. Borrower items overdue
  if (input.borrowerOverdueCount > 0) {
    return "borrower_items_overdue";
  }

  // 5. Uploads waiting review
  if (input.reviewBacklogCount > 0) {
    return "uploads_waiting_review";
  }

  // 6. Readiness blockers
  if (input.blockerCodes.some((b) => READINESS_BLOCKERS.includes(b))) {
    return "readiness_blocked";
  }

  // 7. Builder incomplete
  if (input.blockerCodes.some((b) => BUILDER_BLOCKERS.includes(b))) {
    return "builder_incomplete";
  }

  // 8. Memo gaps
  if (input.blockerCodes.some((b) => MEMO_BLOCKERS.includes(b))) {
    return "memo_gap_aging";
  }

  // 9. Pricing waiting
  if (input.blockerCodes.some((b) => PRICING_BLOCKERS.includes(b))) {
    return "pricing_waiting";
  }

  // 10. Committee ready
  if (input.canonicalStage === "committee_ready") {
    return "committee_ready";
  }

  // 11. Closing stalled
  if (
    input.canonicalStage === "closing_in_progress" &&
    input.stuckReasonCodes.includes("closing_stalled")
  ) {
    return "closing_stalled";
  }

  // 12. Stale primary action (non-critical)
  if (input.isPrimaryActionStale) {
    return "critical_primary_action_stale";
  }

  // Default: healthy
  return "healthy_monitoring";
}
