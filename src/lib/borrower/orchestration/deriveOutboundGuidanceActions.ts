/**
 * Phase 54C — Outbound Guidance Orchestration
 *
 * Derives what outbound actions should occur based on guidance/review
 * state changes. Default: draft-first for non-transactional messages.
 * Respects existing throttle and approval patterns.
 *
 * Pure function — no DB calls, no sends.
 */

type OutboundActionType =
  | "portal_banner"
  | "email_draft"
  | "sms_draft"
  | "approved_send"
  | "no_send_throttled";

type OutboundTriggerEvent =
  | "critical_condition_stalled"
  | "clarification_requested"
  | "evidence_rejected"
  | "evidence_received_confirmation"
  | "waiting_on_bank"
  | "milestone_crossed"
  | "repeated_inaction";

export type OutboundGuidanceAction = {
  actionType: OutboundActionType;
  triggerEvent: OutboundTriggerEvent;
  templateKey: string;
  rationale: string;
  recommendedChannel: "portal" | "email" | "sms";
  throttleResult: "allowed" | "suppressed";
  approvalRequired: boolean;
  linkedConditionId: string | null;
};

type OrchestrationInput = {
  triggerEvent: OutboundTriggerEvent;
  conditionId?: string | null;
  conditionTitle?: string | null;
  borrowerName?: string | null;
  recentMessageCount: number;
  maxMessagesPerWindow: number;
  /** Whether auto-send is approved for this event type */
  autoSendApproved?: boolean;
};

const THROTTLE_WINDOW_MESSAGES = 2; // default max per 7-day window

/**
 * Derive outbound guidance actions from a workflow event.
 * Returns what should happen — caller is responsible for execution.
 */
export function deriveOutboundGuidanceActions(input: OrchestrationInput): OutboundGuidanceAction {
  const {
    triggerEvent,
    conditionId = null,
    conditionTitle,
    borrowerName,
    recentMessageCount,
    maxMessagesPerWindow = THROTTLE_WINDOW_MESSAGES,
    autoSendApproved = false,
  } = input;

  // Throttle check
  const throttled = recentMessageCount >= maxMessagesPerWindow;

  if (throttled) {
    return {
      actionType: "no_send_throttled",
      triggerEvent,
      templateKey: mapTriggerToTemplate(triggerEvent),
      rationale: `Throttled: ${recentMessageCount} messages already sent in window (max ${maxMessagesPerWindow})`,
      recommendedChannel: "portal",
      throttleResult: "suppressed",
      approvalRequired: false,
      linkedConditionId: conditionId,
    };
  }

  // Transactional confirmations can auto-send
  if (triggerEvent === "evidence_received_confirmation") {
    return {
      actionType: autoSendApproved ? "approved_send" : "portal_banner",
      triggerEvent,
      templateKey: "upload_confirmation",
      rationale: "Transactional confirmation of upload receipt",
      recommendedChannel: "portal",
      throttleResult: "allowed",
      approvalRequired: false,
      linkedConditionId: conditionId,
    };
  }

  // Non-transactional: draft-first
  const isHighUrgency = triggerEvent === "evidence_rejected" || triggerEvent === "clarification_requested";
  const channel = isHighUrgency ? "email" : "portal";

  return {
    actionType: isHighUrgency ? "email_draft" : "portal_banner",
    triggerEvent,
    templateKey: mapTriggerToTemplate(triggerEvent),
    rationale: buildRationale(triggerEvent, conditionTitle),
    recommendedChannel: channel,
    throttleResult: "allowed",
    approvalRequired: !autoSendApproved,
    linkedConditionId: conditionId,
  };
}

function mapTriggerToTemplate(event: OutboundTriggerEvent): string {
  const map: Record<OutboundTriggerEvent, string> = {
    critical_condition_stalled: "nudge_critical_stalled",
    clarification_requested: "clarification_request",
    evidence_rejected: "evidence_rejection_notice",
    evidence_received_confirmation: "upload_confirmation",
    waiting_on_bank: "status_update_in_review",
    milestone_crossed: "milestone_celebration",
    repeated_inaction: "gentle_reminder",
  };
  return map[event] ?? "generic_update";
}

function buildRationale(event: OutboundTriggerEvent, conditionTitle?: string | null): string {
  const title = conditionTitle ?? "a condition";
  const map: Record<OutboundTriggerEvent, string> = {
    critical_condition_stalled: `Required condition "${title}" has been stalled with no activity`,
    clarification_requested: `Banker requested clarification on "${title}"`,
    evidence_rejected: `Evidence for "${title}" was not accepted — borrower needs to retry`,
    evidence_received_confirmation: "Confirming receipt of borrower upload",
    waiting_on_bank: "Borrower has no actionable items — bank review in progress",
    milestone_crossed: "Borrower crossed a readiness milestone",
    repeated_inaction: `Borrower has not acted on "${title}" despite prior nudges`,
  };
  return map[event] ?? "Guidance-triggered outbound action";
}
