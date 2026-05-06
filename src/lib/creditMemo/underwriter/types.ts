// Underwriter decision payload — recorded against a banker-submitted
// credit_memo_snapshots row. The decision flows the snapshot from
// 'banker_submitted' to 'finalized' or 'returned'.

export type UnderwriterDecision =
  | "approved"
  | "declined"
  | "returned_for_revision";

export type UnderwriterRequestedChange = {
  section_key: string;
  comment: string;
  severity: "minor" | "material" | "blocker";
};

export type UnderwriterCondition = {
  label: string;
  owner: "banker" | "borrower" | "underwriter";
  due_before: "closing" | "approval" | "funding";
};

export type UnderwriterFeedback = {
  decision: UnderwriterDecision;
  underwriter_id: string;
  decided_at: string;
  summary: string;
  requested_changes: UnderwriterRequestedChange[];
  conditions: UnderwriterCondition[];
};
