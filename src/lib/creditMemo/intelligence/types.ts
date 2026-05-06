// Credit Memo Intelligence Layer — types.
//
// This module reads ONLY from credit_memo_snapshots.memo_output_json.
// It never reads live deal_financial_facts, never calls
// buildCanonicalCreditMemo, and never mutates a submitted snapshot.

export type MemoDiffSeverity = "minor" | "moderate" | "material";
export type RiskDirection = "improving" | "deteriorating" | "neutral";
export type RiskImpact = "positive" | "negative" | "neutral";

export type MemoFieldChange = {
  path: string;
  label: string;
  before: unknown;
  after: unknown;
  severity: MemoDiffSeverity;
};

export type MemoSectionDiff = {
  section_key: string;
  section_title: string;
  changed: boolean;
  changes: MemoFieldChange[];
};

export type MemoVersionDiff = {
  from_snapshot_id: string;
  to_snapshot_id: string;
  from_version: number;
  to_version: number;
  changed_sections: MemoSectionDiff[];
  material_changes: MemoFieldChange[];
  summary: string;
};

export type RiskDeltaDirection = "up" | "down" | "unchanged" | "added" | "removed";

export type RiskDeltaDriver = {
  factor: string;
  before: number | string | null;
  after: number | string | null;
  direction: RiskDeltaDirection;
  impact: RiskImpact;
  explanation: string;
};

export type RiskDeltaAnalysis = {
  from_snapshot_id: string;
  to_snapshot_id: string;
  overall: RiskDirection;
  materiality: MemoDiffSeverity;
  drivers: RiskDeltaDriver[];
  recommendation_shift: string;
};

export type UnderwriterDecisionAnalytics = {
  total_decisions: number;
  approvals: number;
  declines: number;
  returns: number;
  approval_rate: number;
  return_rate: number;
  common_return_reasons: Array<{
    reason: string;
    count: number;
  }>;
  avg_cycles_to_final_decision: number | null;
};

// Minimal shape the intelligence engines need from a snapshot row.
// We deliberately type this as the loose shape because the engines
// must tolerate rows that pre-date the Florida Armory schema (legacy
// auto-pipeline rows have different memo_output_json shapes).
export type IntelligenceSnapshotRow = {
  id: string;
  memo_version: number;
  status?: string;
  memo_output_json: unknown;
  underwriter_feedback_json: unknown;
};

export type CreditMemoIntelligencePayload = {
  latest_snapshot_id: string | null;
  previous_snapshot_id: string | null;
  version_diff: MemoVersionDiff | null;
  risk_delta: RiskDeltaAnalysis | null;
  decision_analytics: UnderwriterDecisionAnalytics;
};
