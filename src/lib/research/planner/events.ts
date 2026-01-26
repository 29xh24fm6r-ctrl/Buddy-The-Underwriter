/**
 * Research Planner Ledger Events
 *
 * Emits events to the deal_events ledger for auditability.
 * Every autonomous decision Buddy makes is recorded.
 */

import "server-only";

import { writeEvent } from "@/lib/ledger/writeEvent";
import type {
  ResearchPlan,
  ProposedMission,
  PlanTriggerEvent,
} from "./types";

// ============================================================================
// Event Kind Constants
// ============================================================================

export const RESEARCH_EVENT_KINDS = {
  INTENT_INFERRED: "buddy.research.intent_inferred",
  PLAN_CREATED: "buddy.research.plan_created",
  PLAN_APPROVED: "buddy.research.plan_approved",
  MISSION_AUTO_STARTED: "buddy.research.mission_auto_started",
  MISSION_COMPLETED: "buddy.research.mission_completed",
  MISSION_FAILED: "buddy.research.mission_failed",
  MISSION_SKIPPED: "buddy.research.mission_skipped",
} as const;

// ============================================================================
// Event Emitters
// ============================================================================

/**
 * Emit event when research intent is inferred.
 */
export async function emitIntentInferred(
  dealId: string,
  planId: string,
  missionType: string,
  rationale: string,
  confidence: number,
  supportingFactIds: string[],
  ruleName: string
): Promise<void> {
  await writeEvent({
    dealId,
    kind: RESEARCH_EVENT_KINDS.INTENT_INFERRED,
    scope: "research",
    action: "intent_inferred",
    output: {
      plan_id: planId,
      mission_type: missionType,
      rationale,
      rule_name: ruleName,
    },
    confidence,
    evidence: {
      supporting_fact_ids: supportingFactIds,
    },
    meta: {
      autonomous: true,
    },
  });
}

/**
 * Emit event when a research plan is created.
 */
export async function emitPlanCreated(
  dealId: string,
  plan: ResearchPlan,
  triggerEvent: PlanTriggerEvent
): Promise<void> {
  await writeEvent({
    dealId,
    kind: RESEARCH_EVENT_KINDS.PLAN_CREATED,
    scope: "research",
    action: "plan_created",
    output: {
      plan_id: plan.id,
      proposed_count: plan.proposed_missions.length,
      missions: plan.proposed_missions.map((m) => ({
        type: m.mission_type,
        priority: m.priority,
        confidence: m.confidence,
      })),
      trigger_event: triggerEvent,
      auto_approved: plan.approved && plan.approved_by === "system",
    },
    evidence: {
      input_facts_count: plan.input_facts_snapshot.length,
      underwriting_stance: plan.underwriting_stance,
    },
    meta: {
      autonomous: true,
      version: plan.version,
    },
  });
}

/**
 * Emit event when a plan is approved (by banker).
 */
export async function emitPlanApproved(
  dealId: string,
  planId: string,
  approvedBy: "system" | "banker",
  userId?: string
): Promise<void> {
  await writeEvent({
    dealId,
    kind: RESEARCH_EVENT_KINDS.PLAN_APPROVED,
    scope: "research",
    action: "plan_approved",
    actorUserId: userId,
    output: {
      plan_id: planId,
      approved_by: approvedBy,
    },
    meta: {
      autonomous: approvedBy === "system",
    },
  });
}

/**
 * Emit event when a mission is auto-started.
 */
export async function emitMissionAutoStarted(
  dealId: string,
  planId: string,
  missionId: string,
  missionType: string,
  rationale: string
): Promise<void> {
  await writeEvent({
    dealId,
    kind: RESEARCH_EVENT_KINDS.MISSION_AUTO_STARTED,
    scope: "research",
    action: "mission_auto_started",
    output: {
      plan_id: planId,
      mission_id: missionId,
      mission_type: missionType,
      rationale,
    },
    meta: {
      autonomous: true,
    },
  });
}

/**
 * Emit event when a mission completes.
 */
export async function emitMissionCompleted(
  dealId: string,
  missionId: string,
  missionType: string,
  sourcesCount: number,
  factsCount: number,
  inferencesCount: number,
  durationMs: number
): Promise<void> {
  await writeEvent({
    dealId,
    kind: RESEARCH_EVENT_KINDS.MISSION_COMPLETED,
    scope: "research",
    action: "mission_completed",
    output: {
      mission_id: missionId,
      mission_type: missionType,
      sources_count: sourcesCount,
      facts_count: factsCount,
      inferences_count: inferencesCount,
      duration_ms: durationMs,
    },
    meta: {
      autonomous: true,
    },
  });
}

/**
 * Emit event when a mission fails.
 */
export async function emitMissionFailed(
  dealId: string,
  missionId: string,
  missionType: string,
  error: string
): Promise<void> {
  await writeEvent({
    dealId,
    kind: RESEARCH_EVENT_KINDS.MISSION_FAILED,
    scope: "research",
    action: "mission_failed",
    output: {
      mission_id: missionId,
      mission_type: missionType,
      error,
    },
    meta: {
      autonomous: true,
    },
  });
}

/**
 * Emit event when a mission is skipped by banker.
 */
export async function emitMissionSkipped(
  dealId: string,
  planId: string,
  missionType: string,
  userId?: string
): Promise<void> {
  await writeEvent({
    dealId,
    kind: RESEARCH_EVENT_KINDS.MISSION_SKIPPED,
    scope: "research",
    action: "mission_skipped",
    actorUserId: userId,
    output: {
      plan_id: planId,
      mission_type: missionType,
    },
    meta: {
      autonomous: false,
      human_override: true,
    },
  });
}

// ============================================================================
// Convenience: Emit all events for a new plan
// ============================================================================

/**
 * Emit all events for a newly created plan.
 * Call this after plan creation to record the full decision trail.
 */
export async function emitPlanEvents(
  dealId: string,
  plan: ResearchPlan,
  triggerEvent: PlanTriggerEvent,
  intentLogs: Array<{
    mission_type?: string | null;
    rationale: string;
    confidence: number;
    supporting_fact_ids: string[];
    rule_name: string;
    intent_type: string;
  }>
): Promise<void> {
  // Emit plan created
  await emitPlanCreated(dealId, plan, triggerEvent);

  // Emit intent inferred for each proposed mission
  for (const log of intentLogs) {
    if (log.intent_type === "mission_proposed" && log.mission_type) {
      await emitIntentInferred(
        dealId,
        plan.id,
        log.mission_type,
        log.rationale,
        log.confidence,
        log.supporting_fact_ids,
        log.rule_name
      );
    }
  }

  // Emit plan approved if auto-approved
  if (plan.approved && plan.approved_by === "system") {
    await emitPlanApproved(dealId, plan.id, "system");
  }
}
