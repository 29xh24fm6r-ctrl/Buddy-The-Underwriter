/**
 * Distribution layer types.
 * Canonical outward-facing package types for borrower, banker, and relationship channels.
 * Pure — no DB, no server-only.
 */

import type { BorrowerOptionSummary } from "@/lib/structuring/types";

// ── Borrower ─────────────────────────────────────────────────────

export type BorrowerDistributionPackage = {
  summary_headline: string;
  summary_body: string;

  next_steps: Array<{
    id: string;
    title: string;
    description: string;
    action_type: "upload" | "answer" | "review" | "contact_bank";
    checklist_key?: string | null;
  }>;

  document_requests: Array<{
    checklist_key: string;
    title: string;
    description: string | null;
    required: boolean;
  }>;

  option_summaries: BorrowerOptionSummary[];

  safe_progress_context: {
    progress_pct: number | null;
    expected_count: number | null;
    missing_critical_count: number | null;
  };
};

// ── Banker / RM ──────────────────────────────────────────────────

export type BankerDistributionPackage = {
  approved_structure_summary: string;
  borrower_outreach_cover_message: string;
  send_package_items: Array<{
    type: "question" | "document_request";
    title: string;
    description: string | null;
  }>;
  recommendation_summary: string | null;
  exception_summary: string | null;
  banker_action_items: string[];
};

// ── Relationship / Treasury ──────────────────────────────────────

export type TreasuryProposalSummary = {
  product: string;
  rationale: string;
  estimated_annual_fee?: number | null;
};

export type RelationshipDistributionPackage = {
  treasury_proposals: TreasuryProposalSummary[];
  relationship_pricing_summary: string | null;
  rm_summary: string;
  borrower_safe_relationship_summary?: string | null;
  compliance_note: string;
};

// ── Full canonical package ───────────────────────────────────────

export type DistributionPackage = {
  deal_id: string;
  package_id: string;
  generated_at: string;
  generated_by: string | null;

  approved_structure_snapshot: Record<string, unknown>;
  approved_exceptions_snapshot: unknown[];
  approved_mitigants_snapshot: string[];

  borrower_package: BorrowerDistributionPackage;
  banker_package: BankerDistributionPackage;
  relationship_package: RelationshipDistributionPackage;

  source_freeze_id: string;
  source_committee_decision_id?: string | null;
  source_memo_snapshot_id?: string | null;
};
