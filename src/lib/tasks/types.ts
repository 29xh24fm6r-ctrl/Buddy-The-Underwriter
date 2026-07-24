import "server-only";

/**
 * Structured task system — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 §5.3.
 */

export const TASK_CATEGORIES = [
  "borrower_follow_up",
  "referral_follow_up",
  "document_request",
  "financial_review",
  "eligibility_review",
  "lender_research",
  "submission",
  "lender_follow_up",
  "underwriting_condition",
  "third_party_report",
  "commitment",
  "closing",
  "post_closing",
  "internal_review",
  "other",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = ["open", "in_progress", "blocked", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type BrokerageTask = {
  id: string;
  bank_id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  deal_id: string | null;
  lead_id: string | null;
  organization_id: string | null;
  person_id: string | null;
  assigned_to_clerk_user_id: string | null;
  assigned_role: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_at: string | null;
  reminder_at: string | null;
  recurrence_rule: string | null;
  depends_on_task_id: string | null;
  blocking: boolean;
  automation_source: string | null;
  completion_outcome: string | null;
  completed_by_clerk_user_id: string | null;
  completed_at: string | null;
  escalation_state: "none" | "flagged" | "escalated";
  created_by_clerk_user_id: string | null;
  created_at: string;
  updated_at: string;
};
