// Phase 65P — Autonomous Assist Types
// Zero runtime imports. Pure type definitions only.

import type { RelationshipEvidenceEnvelope } from "../relationship-surface/types";

// ─── Autonomy Mode ────────────────────────────────────────────────────────────

export type RelationshipAutonomyMode =
  | "manual"
  | "assistive"
  | "precommit_review"
  | "controlled_autonomy";

// ─── Autonomy Action Types ────────────────────────────────────────────────────

export type AutonomyActionType =
  | "create_internal_task"
  | "create_review_reminder"
  | "draft_borrower_message"
  | "draft_internal_note"
  | "resend_borrower_reminder"
  | "request_surface_refresh"
  | "schedule_internal_followup";

export type AutonomyExecutionMode =
  | "draft_only"
  | "approval_required"
  | "auto_execute";

export type AutonomyActionRiskTier = "low" | "medium" | "high";

// ─── Autonomy Action ──────────────────────────────────────────────────────────

export type RelationshipAutonomyAction = {
  id: string;
  actionType: AutonomyActionType;
  executionMode: AutonomyExecutionMode;
  relatedCanonicalActionCode: string | null;
  relatedReasonCode: string | null;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  evidence: RelationshipEvidenceEnvelope[];
  reversible: boolean;
  riskTier: AutonomyActionRiskTier;
};

// ─── Autonomy Plan ────────────────────────────────────────────────────────────

export type RelationshipAutonomyPlan = {
  relationshipId: string;
  bankId: string;
  mode: RelationshipAutonomyMode;
  generatedAt: string;
  source: {
    canonicalState: string;
    primaryReasonCode: string;
    primaryActionCode: string | null;
    omegaUsed: boolean;
  };
  actions: RelationshipAutonomyAction[];
  rationale: string[];
  requiresApproval: boolean;
};

// ─── Guardrail Result ─────────────────────────────────────────────────────────

export type RelationshipAutonomyGuardrailResult = {
  ok: boolean;
  errors: string[];
  blockedActionIds: string[];
};

// ─── Plan Status ──────────────────────────────────────────────────────────────

export type AutonomyPlanStatus =
  | "generated"
  | "approved"
  | "partially_executed"
  | "executed"
  | "blocked"
  | "cancelled"
  | "failed";

// ─── Execution Status ─────────────────────────────────────────────────────────

export type AutonomyExecutionStatus =
  | "planned"
  | "blocked"
  | "approved"
  | "executed"
  | "failed"
  | "cancelled";

// ─── Event Codes ──────────────────────────────────────────────────────────────

export type RelationshipAutonomyEventCode =
  | "autonomy_plan_generated"
  | "autonomy_plan_blocked"
  | "autonomy_plan_approved"
  | "autonomy_action_executed"
  | "autonomy_action_failed"
  | "autonomy_plan_cancelled"
  | "autonomy_mode_changed"
  | "autonomy_kill_switch_blocked";

// ─── Guardrail Input ──────────────────────────────────────────────────────────

export type GuardrailInput = {
  plan: RelationshipAutonomyPlan;
  featureFlagEnabled: boolean;
  killSwitchActive: boolean;
  hasIntegrityFailure: boolean;
  hasCriticalMonitoringException: boolean;
  hasCryptoLiquidationReview: boolean;
  hasCriticalProtectionCase: boolean;
  hasRenewalPolicyHardStop: boolean;
  relationshipActive: boolean;
};

// ─── Eligible Actions Input ───────────────────────────────────────────────────

export type EligibleActionsInput = {
  mode: RelationshipAutonomyMode;
  canonicalState: string;
  primaryReasonCode: string;
  primaryActionCode: string | null;
  omegaRecommendations: Array<{
    action: string;
    relatedCanonicalAction?: string;
    priority: string;
  }>;
  relationshipId: string;
};
