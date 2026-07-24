import "server-only";

/**
 * Sequence definitions — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 §6.6.
 *
 * Static, deterministic, in-code catalog (same pattern as PR3's
 * STAGE_TASK_PLANS) — not a DB-driven rule-authoring system. "Borrower
 * campaign" (src/core/borrower-orchestration) is a same-word, different
 * system (document-collection orchestration for one deal, not a CRM
 * contact cadence) per discovery — this is genuinely new construction,
 * not a duplicate of that.
 */

import type { TaskCategory } from "@/lib/tasks/types";
import type { TemplateTriggerKey } from "@/lib/comms/templates";

export type SequenceEntityType = "lead" | "deal" | "organization";
export type SequenceActionKey = "create_task" | "queue_communication_for_approval" | "add_activity";

export type SequenceStep = {
  dayOffset: number;
  action: SequenceActionKey;
  title: string;
  category?: TaskCategory;
  templateTriggerKey?: TemplateTriggerKey;
};

export type SequenceDefinition = {
  key: string;
  label: string;
  entityType: SequenceEntityType;
  steps: readonly SequenceStep[];
};

export const SEQUENCE_CATALOG: Record<string, SequenceDefinition> = {
  new_lead_follow_up: {
    key: "new_lead_follow_up",
    label: "New lead follow-up",
    entityType: "lead",
    steps: [
      { dayOffset: 0, action: "queue_communication_for_approval", title: "Welcome the new lead", templateTriggerKey: "initial_lead_response" },
      { dayOffset: 2, action: "create_task", title: "Follow-up call with new lead", category: "borrower_follow_up" },
      { dayOffset: 5, action: "create_task", title: "Second follow-up attempt", category: "borrower_follow_up" },
    ],
  },
  unresponsive_lead: {
    key: "unresponsive_lead",
    label: "Unresponsive lead",
    entityType: "lead",
    steps: [
      { dayOffset: 0, action: "create_task", title: "Try an alternate contact method", category: "borrower_follow_up" },
      { dayOffset: 3, action: "create_task", title: "Final attempt before moving to nurture", category: "borrower_follow_up" },
    ],
  },
  qualified_lead_engagement: {
    key: "qualified_lead_engagement",
    label: "Qualified lead engagement",
    entityType: "lead",
    steps: [
      { dayOffset: 0, action: "queue_communication_for_approval", title: "Send engagement follow-up", templateTriggerKey: "engagement_follow_up" },
      { dayOffset: 3, action: "create_task", title: "Check on engagement letter status", category: "borrower_follow_up" },
    ],
  },
  missing_document_chase: {
    key: "missing_document_chase",
    label: "Missing-document chase",
    entityType: "deal",
    steps: [
      { dayOffset: 0, action: "queue_communication_for_approval", title: "Request missing documents", category: "document_request", templateTriggerKey: "document_request" },
      { dayOffset: 3, action: "create_task", title: "Follow up on missing documents", category: "document_request" },
      { dayOffset: 7, action: "create_task", title: "Escalate missing-document chase", category: "document_request" },
    ],
  },
  referral_partner_nurture: {
    key: "referral_partner_nurture",
    label: "Referral partner nurture",
    entityType: "organization",
    steps: [
      { dayOffset: 0, action: "add_activity", title: "Referral partner nurture check-in logged" },
      { dayOffset: 30, action: "create_task", title: "Quarterly referral partner touchpoint", category: "referral_follow_up" },
    ],
  },
  submitted_deal_lender_follow_up: {
    key: "submitted_deal_lender_follow_up",
    label: "Submitted-deal lender follow-up",
    entityType: "deal",
    steps: [
      { dayOffset: 3, action: "create_task", title: "Check submission status with lender", category: "lender_follow_up" },
      { dayOffset: 7, action: "queue_communication_for_approval", title: "Follow up with lender on submission", category: "lender_follow_up", templateTriggerKey: "submission_follow_up" },
    ],
  },
  post_funding_referral_follow_up: {
    key: "post_funding_referral_follow_up",
    label: "Post-funding referral follow-up",
    entityType: "deal",
    steps: [
      { dayOffset: 1, action: "queue_communication_for_approval", title: "Send funding notification", category: "post_closing", templateTriggerKey: "funding_notification" },
      { dayOffset: 3, action: "add_activity", title: "Post-funding referral thank-you due" },
    ],
  },
};

export function getSequenceDefinition(key: string): SequenceDefinition | null {
  return SEQUENCE_CATALOG[key] ?? null;
}
