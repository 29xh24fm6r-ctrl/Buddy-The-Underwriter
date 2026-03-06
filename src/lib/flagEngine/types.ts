/**
 * Flag Engine Types — Intelligent Flagging & Borrower Question Engine
 *
 * Pure type definitions. No runtime imports.
 */

import type { QualityOfEarningsReport } from "../spreads/qoeEngine";
import type { TrendAnalysisResult } from "../trends/trendAnalysis";
import type { ConsolidationResult } from "../consolidation/consolidationEngine";

// ---------------------------------------------------------------------------
// Enum-like unions
// ---------------------------------------------------------------------------

export type FlagCategory =
  | "financial_irregularity"
  | "missing_data"
  | "policy_proximity"
  | "qualitative_risk";

export type FlagSeverity = "critical" | "elevated" | "watch" | "informational";

export type FlagStatus =
  | "open"
  | "banker_reviewed"
  | "sent_to_borrower"
  | "answered"
  | "resolved"
  | "waived";

export type DocumentUrgency =
  | "required_before_approval"
  | "required_before_closing"
  | "preferred";

export type RecipientType = "borrower" | "accountant" | "attorney" | "appraiser";

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export interface SpreadFlag {
  flag_id: string;
  deal_id: string;
  category: FlagCategory;
  severity: FlagSeverity;
  trigger_type: string;
  canonical_keys_involved: string[];
  observed_value: number | string | null;
  expected_range?: { min?: number; max?: number; description: string };
  year_observed?: number;
  banker_summary: string;
  banker_detail: string;
  banker_implication: string;
  borrower_question: BorrowerQuestion | null;
  status: FlagStatus;
  banker_note?: string;
  borrower_response?: string;
  resolution_note?: string;
  waived_by?: string;
  waived_reason?: string;
  auto_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface BorrowerQuestion {
  question_id: string;
  flag_id: string;
  question_text: string;
  question_context: string;
  document_requested?: string;
  document_format?: string;
  document_urgency: DocumentUrgency;
  recipient_type: RecipientType;
  send_method?: "email" | "portal" | "manual";
  sent_at?: string;
  answered_at?: string;
  answer_text?: string;
}

// ---------------------------------------------------------------------------
// Re-export upstream types under spec names
// ---------------------------------------------------------------------------

export type QoEReport = QualityOfEarningsReport;
export type TrendReport = TrendAnalysisResult;
export type ConsolidatedSpread = ConsolidationResult;

// ---------------------------------------------------------------------------
// Engine I/O
// ---------------------------------------------------------------------------

export interface FlagEngineInput {
  deal_id: string;
  canonical_facts: Record<string, unknown>;
  ratios: Record<string, number | null>;
  qoe_report?: QoEReport;
  trend_report?: TrendReport;
  consolidated_spread?: ConsolidatedSpread;
  years_available: number[];
  deal_type?: string;
}

export interface FlagEngineOutput {
  deal_id: string;
  flags: SpreadFlag[];
  critical_count: number;
  elevated_count: number;
  watch_count: number;
  informational_count: number;
  has_blocking_flags: boolean;
  send_package?: SendPackage;
}

export interface SendPackage {
  deal_id: string;
  cover_message: string;
  questions: BorrowerQuestion[];
  document_requests: BorrowerQuestion[];
  assembled_at: string;
}

// ---------------------------------------------------------------------------
// Registry rule definition
// ---------------------------------------------------------------------------

export interface FlagRule {
  trigger_type: string;
  category: FlagCategory;
  default_severity: FlagSeverity;
  description: string;
  canonical_keys_involved: string[];
  generates_question: boolean;
  recipient_type: RecipientType;
}
