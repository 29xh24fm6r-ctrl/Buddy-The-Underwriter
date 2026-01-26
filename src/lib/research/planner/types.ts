/**
 * Buddy Autonomous Research Planner - Types
 *
 * Types for the planning layer that sits above the Research Engine.
 * The planner decides WHAT research to run, WHY, and in WHAT ORDER.
 */

import type { MissionType, MissionSubject, ResearchFact } from "../types";
import type { UnderwritingStance } from "@/lib/underwrite/deriveUnderwritingStance";

// Re-export for convenience
export type { UnderwritingStance };

// ============================================================================
// Trigger Events
// ============================================================================

export type PlanTriggerEvent =
  | "document_uploaded"
  | "checklist_updated"
  | "stance_changed"
  | "mission_completed"
  | "manual_request"
  | "initial_evaluation";

// ============================================================================
// Proposed Mission
// ============================================================================

export type ProposedMissionStatus =
  | "pending"      // Awaiting approval
  | "approved"     // Approved, ready to execute
  | "rejected"     // Banker rejected
  | "executing"    // Currently running
  | "completed"    // Finished
  | "failed";      // Execution failed

export type ProposedMission = {
  mission_type: MissionType;
  subject: MissionSubject;
  priority: number;              // 1 = highest priority
  rationale: string;             // Human-readable explanation
  confidence: number;            // 0-1
  supporting_fact_ids: string[]; // Facts that triggered this
  status: ProposedMissionStatus;
  mission_id?: string;           // Set once mission is created
};

// ============================================================================
// Research Plan
// ============================================================================

export type ResearchPlan = {
  id: string;
  deal_id: string;
  bank_id?: string | null;

  // Plan content
  proposed_missions: ProposedMission[];

  // Approval
  approved: boolean;
  approved_by: "system" | "banker";
  approved_at?: string | null;
  approved_by_user_id?: string | null;

  // Trigger context
  trigger_event: PlanTriggerEvent;
  trigger_document_id?: string | null;
  trigger_mission_id?: string | null;

  // Input snapshot
  input_facts_snapshot: ResearchFact[];
  underwriting_stance?: string | null;

  // Versioning
  version: number;
  superseded_by?: string | null;
  is_current: boolean;

  // Timestamps
  created_at: string;
  executed_at?: string | null;
  correlation_id?: string | null;
};

// ============================================================================
// Intent Types
// ============================================================================

export type IntentType =
  | "mission_proposed"
  | "mission_skipped"
  | "mission_deferred"
  | "gap_identified"
  | "prerequisite_missing";

export type ResearchIntentLog = {
  id: string;
  plan_id: string;
  deal_id: string;

  intent_type: IntentType;
  mission_type?: MissionType | null;

  rationale: string;
  confidence: number;

  supporting_fact_ids: string[];
  supporting_fact_types: string[];

  rule_name: string;
  rule_version: number;

  created_at: string;
};

// ============================================================================
// Entity Signals (Extracted from Tax Returns)
// ============================================================================

export type EntitySignals = {
  // From Business Tax Returns
  legal_company_name?: string;
  ein?: string;
  naics_code?: string;
  entity_type?: "C-Corp" | "S-Corp" | "Partnership" | "LLC" | "Sole Prop";
  gross_receipts?: number;
  net_income?: number;
  tax_year?: number;

  // Ownership
  principals?: Principal[];

  // Geography
  operating_states?: string[];
  headquarters_state?: string;

  // From Personal Tax Returns
  taxpayer_names?: string[];
  related_entities?: string[];
};

export type Principal = {
  name: string;
  title?: string;
  ownership_pct: number;
  ssn_last4?: string;  // For matching
};

// ============================================================================
// Planner Input
// ============================================================================

export type PlannerInput = {
  deal_id: string;
  bank_id?: string | null;

  // Extracted signals
  entity_signals: EntitySignals;

  // Deal context
  deal_purpose?: string;
  loan_type?: string;
  loan_amount?: number;

  // Current state
  underwriting_stance?: string;
  extracted_facts: ResearchFact[];
  existing_missions: ExistingMission[];
  checklist_completion_pct?: number;

  // Trigger
  trigger_event: PlanTriggerEvent;
  trigger_document_id?: string;
  trigger_mission_id?: string;
};

export type ExistingMission = {
  id: string;
  mission_type: MissionType;
  subject: MissionSubject;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  completed_at?: string | null;
};

// ============================================================================
// Planner Output
// ============================================================================

export type PlannerOutput = {
  ok: boolean;
  proposed_missions: ProposedMission[];
  intent_logs: Omit<ResearchIntentLog, "id" | "plan_id" | "deal_id" | "created_at">[];
  gaps_identified: string[];
  error?: string;
};

// ============================================================================
// Regulated Industry Lookup
// ============================================================================

export type RegulatedIndustry = {
  naics_prefix: string;
  industry_name: string;
  regulatory_bodies: string[];
  requires_state_licensing: boolean;
  notes?: string;
};

// ============================================================================
// Rule Definition
// ============================================================================

export type PlannerRule = {
  name: string;
  version: number;
  description: string;
  mission_type: MissionType;
  evaluate: (input: PlannerInput) => RuleResult | null;
};

export type RuleResult = {
  should_run: boolean;
  priority: number;
  subject: MissionSubject;
  rationale: string;
  confidence: number;
  supporting_fact_ids: string[];
  defer_reason?: string;  // If should_run is false but might run later
};

// ============================================================================
// API Types
// ============================================================================

export type EvaluatePlanInput = {
  deal_id: string;
  trigger_event: PlanTriggerEvent;
  trigger_document_id?: string;
  trigger_mission_id?: string;
  auto_approve?: boolean;  // Default true
  auto_execute?: boolean;  // Default true
};

export type EvaluatePlanResult = {
  ok: boolean;
  plan_id?: string;
  proposed_count: number;
  approved: boolean;
  executing: boolean;
  error?: string;
};

export type GetPlanResult = {
  ok: boolean;
  plan?: ResearchPlan;
  intent_logs?: ResearchIntentLog[];
  error?: string;
};

export type ApproveMissionInput = {
  plan_id: string;
  mission_index: number;
  approved: boolean;
  user_id?: string;
};

export type ApproveMissionResult = {
  ok: boolean;
  error?: string;
};
