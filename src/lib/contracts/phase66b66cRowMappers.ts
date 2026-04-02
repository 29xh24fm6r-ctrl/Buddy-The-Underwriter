/**
 * Phase 66B/66C Row Mappers — Surgical Schema-Contract Remediation
 *
 * Maps between DB row shapes (migration column names) and domain/API shapes.
 * Source of truth: the migrations in supabase/migrations/.
 */

// ============================================================================
// Material Change Events
// ============================================================================

/** DB row shape for buddy_material_change_events */
export type MaterialChangeRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  buddy_research_mission_id: string | null;
  change_type: string;
  change_scope: string;
  old_fingerprint: string | null;
  new_fingerprint: string | null;
  materiality_score: string;
  affected_systems_json: Record<string, unknown>;
  reuse_plan_json: Record<string, unknown>;
  created_at: string;
};

/** Domain shape used in application code */
export type MaterialChangeDomain = {
  id: string;
  dealId: string;
  bankId: string;
  missionId: string | null;
  changeType: string;
  scope: string;
  materiality: string;
  invalidationPlan: Record<string, unknown>;
  reusePlan: Record<string, unknown>;
  oldFingerprint: string | null;
  newFingerprint: string | null;
  createdAt: string;
};

/** Map scope → DB materiality_score enum */
export function scopeToMaterialityScore(scope: string): string {
  switch (scope) {
    case "trivial": return "none";
    case "localized": return "low";
    case "material": return "medium";
    case "mission_wide": return "critical";
    default: return "low";
  }
}

export function materialChangeRowToDomain(row: MaterialChangeRow): MaterialChangeDomain {
  return {
    id: row.id,
    dealId: row.deal_id,
    bankId: row.bank_id,
    missionId: row.buddy_research_mission_id,
    changeType: row.change_type,
    scope: row.change_scope,
    materiality: row.materiality_score,
    invalidationPlan: row.affected_systems_json,
    reusePlan: row.reuse_plan_json,
    oldFingerprint: row.old_fingerprint,
    newFingerprint: row.new_fingerprint,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Agent Handoffs
// ============================================================================

export type AgentHandoffRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  from_agent_type: string;
  to_agent_type: string;
  visibility_scope: string;
  handoff_type: string;
  status: string;
  task_contract_json: Record<string, unknown>;
  result_summary_json: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
};

export type AgentHandoffDomain = {
  id: string;
  dealId: string;
  bankId: string;
  fromAgent: string;
  toAgent: string;
  visibility: string;
  handoffType: string;
  status: string;
  taskContract: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
};

export function agentHandoffRowToDomain(row: AgentHandoffRow): AgentHandoffDomain {
  return {
    id: row.id,
    dealId: row.deal_id,
    bankId: row.bank_id,
    fromAgent: row.from_agent_type,
    toAgent: row.to_agent_type,
    visibility: row.visibility_scope,
    handoffType: row.handoff_type,
    status: row.status,
    taskContract: row.task_contract_json,
    result: row.result_summary_json,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ============================================================================
// Action Recommendations
// ============================================================================

export function actionRecommendationToRow(
  dealId: string,
  bankId: string,
  r: {
    visibility: string;
    actor: string;
    category: string;
    title?: string;
    description?: string;
    rationale: Record<string, unknown>;
    blockedBy: Record<string, unknown>;
    expectedImpact: Record<string, unknown>;
    priorityScore: number;
    urgencyScore: number;
    confidence: string;
  },
) {
  return {
    deal_id: dealId,
    bank_id: bankId,
    visibility_scope: r.visibility,
    actor_type: r.actor,
    action_category: r.category,
    priority_score: r.priorityScore,
    urgency_score: r.urgencyScore,
    confidence_score: r.confidence,
    rationale_json: {
      ...r.rationale,
      ...(r.title ? { title: r.title } : {}),
      ...(r.description ? { description: r.description } : {}),
    },
    blocked_by_json: r.blockedBy,
    expected_impact_json: r.expectedImpact,
  };
}

// ============================================================================
// Recommendation Outcomes (66C)
// ============================================================================

export function recOutcomeRowToApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    recommendationId: row.recommendation_id,
    outcomeStatus: row.outcome_status,
    acceptedByActorType: row.accepted_by_actor_type,
    usefulnessScore: row.usefulness_score,
    timingScore: row.timing_score,
    impactScore: row.impact_score,
    overridden: row.overridden,
    overrideReason: row.override_reason,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Trust Events (66C)
// ============================================================================

export function trustEventRowToApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    eventType: row.event_type,
    conclusionKey: row.conclusion_key,
    recommendationId: row.recommendation_id,
    payload: row.payload_json,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Readiness Uplift Snapshots (66C)
// ============================================================================

export function upliftRowToApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    readinessScoreBefore: row.readiness_score_before,
    readinessScoreAfter: row.readiness_score_after,
    upliftSummary: row.uplift_summary_json,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Borrower Actions Taken (66C)
// ============================================================================

export function borrowerActionRowToApi(row: Record<string, unknown>) {
  return {
    id: row.id,
    actionKey: row.action_key,
    actionSource: row.action_source,
    status: row.status,
    evidence: row.evidence_json,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
