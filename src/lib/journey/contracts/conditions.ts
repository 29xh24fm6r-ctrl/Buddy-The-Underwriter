/**
 * SPEC-08 — canonical condition row contract.
 *
 * Used by `/conditions`, `/conditions/list`, `ConditionsInlineEditor`,
 * `ApprovalConditionsPanel`, `ClosingConditionsPanel`. Endpoints may emit
 * additional fields, but the core shape below MUST be present.
 */
export type DealConditionStatus = "open" | "satisfied" | "waived" | "rejected";

export type DealConditionSeverity = "info" | "warning" | "critical";

export type DealConditionRow = {
  id: string;
  deal_id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: DealConditionStatus;
  due_date: string | null;
  severity?: DealConditionSeverity | string | null;
  linked_doc_count?: number;
  linked_evidence?: unknown[];
  source?: string | null;
  source_key?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DealConditionsApi = {
  ok?: boolean;
  /** SPEC-07/08 canonical key. */
  conditions?: DealConditionRow[];
  /** SPEC-07 deprecated alias kept for one cycle. Removed in SPEC-09+. */
  items?: DealConditionRow[];
  error?: string;
};
