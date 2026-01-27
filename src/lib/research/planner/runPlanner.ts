/**
 * Research Planner Orchestrator
 *
 * Coordinates the full planning lifecycle:
 * 1. Gather deal context (entities, documents, facts)
 * 2. Extract entity signals
 * 3. Derive research intent
 * 4. Create/update research plan
 * 5. Execute approved missions
 *
 * This is the main entry point for autonomous research planning.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  PlannerInput,
  PlannerOutput,
  ResearchPlan,
  ResearchIntentLog,
  ProposedMission,
  EvaluatePlanInput,
  EvaluatePlanResult,
  PlanTriggerEvent,
  ExistingMission,
} from "./types";
import type { ResearchFact, MissionExecutionResult } from "../types";
import { extractEntitySignals, hasMinimumSignals } from "./extractEntitySignals";
import { deriveResearchIntent } from "./deriveResearchIntent";
import { runMission } from "../runMission";
import { checkMissionGovernance } from "../governance/useCaseRegistry";

// ============================================================================
// Data Gathering
// ============================================================================

/**
 * Gather all context needed for research planning.
 */
async function gatherPlannerContext(dealId: string): Promise<{
  ok: boolean;
  input?: PlannerInput;
  error?: string;
}> {
  const supabase = await createSupabaseServerClient();

  // Fetch deal
  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, purpose, loan_type, loan_amount, bank_id, meta")
    .eq("id", dealId)
    .single();

  if (dealError || !deal) {
    return { ok: false, error: "Deal not found" };
  }

  // Fetch entities
  const { data: entities } = await supabase
    .from("deal_entities")
    .select("id, name, entity_kind, legal_name, ein, ownership_percent, meta")
    .eq("deal_id", dealId);

  // Fetch documents with extracted fields
  const { data: documents } = await supabase
    .from("deal_documents")
    .select("id, classification, extracted_fields")
    .eq("deal_id", dealId)
    .not("extracted_fields", "is", null);

  // Fetch existing research missions
  const { data: missions } = await supabase
    .from("buddy_research_missions")
    .select("id, mission_type, subject, status, completed_at")
    .eq("deal_id", dealId);

  // Fetch extracted research facts
  const { data: facts } = await supabase
    .from("buddy_research_facts")
    .select("*")
    .in(
      "mission_id",
      (missions ?? []).map((m) => m.id)
    );

  // Get underwriting stance from context endpoint (or compute directly)
  // For now, we'll fetch checklist completion as a proxy
  const { data: checklist } = await supabase
    .from("deal_checklist_items")
    .select("checklist_key, status, required")
    .eq("deal_id", dealId);

  // Calculate simple stance proxy
  const receivedCount = (checklist ?? []).filter(
    (c) => c.status === "received" || c.status === "reviewed_accepted" || c.status === "satisfied"
  ).length;
  const requiredCount = (checklist ?? []).filter((c) => c.required).length;
  const completionPct = requiredCount > 0 ? (receivedCount / requiredCount) * 100 : 0;

  // Extract entity signals from gathered data
  const entitySignals = extractEntitySignals(
    deal,
    entities ?? [],
    documents ?? []
  );

  // Build planner input
  const input: PlannerInput = {
    deal_id: dealId,
    bank_id: deal.bank_id,
    entity_signals: entitySignals,
    deal_purpose: deal.purpose ?? undefined,
    loan_type: deal.loan_type ?? undefined,
    loan_amount: deal.loan_amount ?? undefined,
    underwriting_stance: completionPct > 80 ? "ready_for_underwriting" : "insufficient_information",
    extracted_facts: (facts ?? []) as ResearchFact[],
    existing_missions: (missions ?? []).map((m) => ({
      id: m.id,
      mission_type: m.mission_type,
      subject: m.subject,
      status: m.status,
      completed_at: m.completed_at,
    })) as ExistingMission[],
    checklist_completion_pct: completionPct,
    trigger_event: "initial_evaluation",
  };

  return { ok: true, input };
}

// ============================================================================
// Plan Persistence
// ============================================================================

/**
 * Create a new research plan in the database.
 */
async function createPlan(
  input: PlannerInput,
  output: PlannerOutput,
  triggerEvent: PlanTriggerEvent,
  triggerDocumentId?: string,
  triggerMissionId?: string
): Promise<{ ok: boolean; planId?: string; error?: string }> {
  const supabase = await createSupabaseServerClient();

  // Mark previous plans as superseded
  await supabase
    .from("buddy_research_plans")
    .update({ is_current: false })
    .eq("deal_id", input.deal_id)
    .eq("is_current", true);

  // Create new plan
  const { data: plan, error: planError } = await supabase
    .from("buddy_research_plans")
    .insert({
      deal_id: input.deal_id,
      bank_id: input.bank_id,
      proposed_missions: output.proposed_missions,
      approved: true, // Auto-approve by default
      approved_by: "system",
      approved_at: new Date().toISOString(),
      trigger_event: triggerEvent,
      trigger_document_id: triggerDocumentId,
      trigger_mission_id: triggerMissionId,
      input_facts_snapshot: input.extracted_facts,
      underwriting_stance: input.underwriting_stance,
      is_current: true,
    })
    .select("id")
    .single();

  if (planError) {
    return { ok: false, error: planError.message };
  }

  // Insert intent logs
  if (output.intent_logs.length > 0) {
    const { error: logError } = await supabase
      .from("buddy_research_intent_log")
      .insert(
        output.intent_logs.map((log) => ({
          plan_id: plan.id,
          deal_id: input.deal_id,
          intent_type: log.intent_type,
          mission_type: log.mission_type,
          rationale: log.rationale,
          confidence: log.confidence,
          supporting_fact_ids: log.supporting_fact_ids,
          supporting_fact_types: log.supporting_fact_types,
          rule_name: log.rule_name,
          rule_version: log.rule_version,
        }))
      );

    if (logError) {
      console.warn("Failed to insert intent logs:", logError.message);
    }
  }

  return { ok: true, planId: plan.id };
}

/**
 * Update mission status in plan after execution.
 */
async function updatePlanMissionStatus(
  planId: string,
  missionIndex: number,
  status: ProposedMission["status"],
  missionId?: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Fetch current plan
  const { data: plan } = await supabase
    .from("buddy_research_plans")
    .select("proposed_missions")
    .eq("id", planId)
    .single();

  if (!plan) return;

  // Update the specific mission
  const missions = plan.proposed_missions as ProposedMission[];
  if (missions[missionIndex]) {
    missions[missionIndex].status = status;
    if (missionId) {
      missions[missionIndex].mission_id = missionId;
    }
  }

  // Save back
  await supabase
    .from("buddy_research_plans")
    .update({ proposed_missions: missions })
    .eq("id", planId);
}

// ============================================================================
// Mission Execution
// ============================================================================

/**
 * Execute approved missions from a plan.
 */
async function executeApprovedMissions(
  planId: string,
  dealId: string,
  missions: ProposedMission[],
  bankId?: string | null
): Promise<{ executed: number; results: MissionExecutionResult[] }> {
  const results: MissionExecutionResult[] = [];
  let executed = 0;

  // Execute in priority order (already sorted)
  for (let i = 0; i < missions.length; i++) {
    const mission = missions[i];

    // Only execute pending/approved missions
    if (mission.status !== "pending" && mission.status !== "approved") {
      continue;
    }

    // ── Governance enforcement ──────────────────────────────
    // Check AI Use Case Registry before execution
    const governance = await checkMissionGovernance(mission.mission_type);
    if (!governance.allowed) {
      console.warn(
        `[executeApprovedMissions] Blocked by governance: ${governance.reason}`
      );
      await updatePlanMissionStatus(planId, i, "rejected");
      continue;
    }
    if (governance.requires_approval && mission.status !== "approved") {
      console.info(
        `[executeApprovedMissions] Requires approval: ${governance.reason}`
      );
      // Leave as pending — banker must approve before execution
      continue;
    }

    // Mark as executing
    await updatePlanMissionStatus(planId, i, "executing");

    try {
      // Run the mission
      const result = await runMission(dealId, mission.mission_type, mission.subject, {
        bankId,
      });

      results.push(result);
      executed++;

      // Update status based on result
      await updatePlanMissionStatus(
        planId,
        i,
        result.ok ? "completed" : "failed",
        result.mission_id
      );
    } catch (error) {
      console.error(`Mission execution failed:`, error);
      await updatePlanMissionStatus(planId, i, "failed");
    }
  }

  // Mark plan as executed
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("buddy_research_plans")
    .update({ executed_at: new Date().toISOString() })
    .eq("id", planId);

  return { executed, results };
}

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Evaluate and create a research plan for a deal.
 *
 * This is the main entry point for autonomous research planning.
 */
export async function evaluateResearchPlan(
  input: EvaluatePlanInput
): Promise<EvaluatePlanResult> {
  const { deal_id, trigger_event, trigger_document_id, trigger_mission_id } = input;
  const autoApprove = input.auto_approve ?? true;
  const autoExecute = input.auto_execute ?? true;

  // 1. Gather context
  const contextResult = await gatherPlannerContext(deal_id);
  if (!contextResult.ok || !contextResult.input) {
    return {
      ok: false,
      proposed_count: 0,
      approved: false,
      executing: false,
      error: contextResult.error ?? "Failed to gather context",
    };
  }

  const plannerInput = {
    ...contextResult.input,
    trigger_event,
    trigger_document_id,
    trigger_mission_id,
  };

  // 2. Check if we have enough signals
  if (!hasMinimumSignals(plannerInput.entity_signals)) {
    return {
      ok: true,
      proposed_count: 0,
      approved: false,
      executing: false,
      error: "Insufficient entity signals for research planning. Upload business tax returns to enable research.",
    };
  }

  // 3. Derive research intent
  const output = deriveResearchIntent(plannerInput);

  // 4. Create plan
  const planResult = await createPlan(
    plannerInput,
    output,
    trigger_event,
    trigger_document_id,
    trigger_mission_id
  );

  if (!planResult.ok || !planResult.planId) {
    return {
      ok: false,
      proposed_count: output.proposed_missions.length,
      approved: false,
      executing: false,
      error: planResult.error ?? "Failed to create plan",
    };
  }

  // 5. Execute if auto-execute is enabled
  let executing = false;
  if (autoExecute && output.proposed_missions.length > 0) {
    executing = true;

    // Execute in background (don't await)
    executeApprovedMissions(
      planResult.planId,
      deal_id,
      output.proposed_missions,
      plannerInput.bank_id
    ).catch((err) => {
      console.error("Background mission execution failed:", err);
    });
  }

  return {
    ok: true,
    plan_id: planResult.planId,
    proposed_count: output.proposed_missions.length,
    approved: autoApprove,
    executing,
  };
}

/**
 * Get the current research plan for a deal.
 */
export async function getCurrentPlan(dealId: string): Promise<{
  ok: boolean;
  plan?: ResearchPlan;
  intent_logs?: ResearchIntentLog[];
  error?: string;
}> {
  const supabase = await createSupabaseServerClient();

  // Fetch current plan
  const { data: plan, error: planError } = await supabase
    .from("buddy_research_plans")
    .select("*")
    .eq("deal_id", dealId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (planError && planError.code !== "PGRST116") {
    return { ok: false, error: planError.message };
  }

  if (!plan) {
    return { ok: true, plan: undefined };
  }

  // Fetch intent logs
  const { data: logs } = await supabase
    .from("buddy_research_intent_log")
    .select("*")
    .eq("plan_id", plan.id)
    .order("created_at", { ascending: true });

  return {
    ok: true,
    plan: plan as ResearchPlan,
    intent_logs: logs as ResearchIntentLog[],
  };
}

/**
 * Manually approve or reject a mission in a plan.
 */
export async function approveMission(
  planId: string,
  missionIndex: number,
  approved: boolean,
  userId?: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();

  // Fetch plan
  const { data: plan } = await supabase
    .from("buddy_research_plans")
    .select("proposed_missions, deal_id, bank_id")
    .eq("id", planId)
    .single();

  if (!plan) {
    return { ok: false, error: "Plan not found" };
  }

  const missions = plan.proposed_missions as ProposedMission[];
  if (!missions[missionIndex]) {
    return { ok: false, error: "Mission not found at index" };
  }

  // Update status
  missions[missionIndex].status = approved ? "approved" : "rejected";

  // Save
  await supabase
    .from("buddy_research_plans")
    .update({
      proposed_missions: missions,
      approved_by: "banker",
      approved_by_user_id: userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", planId);

  // If approved, execute immediately
  if (approved) {
    const mission = missions[missionIndex];
    executeApprovedMissions(
      planId,
      plan.deal_id,
      [mission],
      plan.bank_id
    ).catch((err) => {
      console.error("Mission execution failed:", err);
    });
  }

  return { ok: true };
}

/**
 * Re-evaluate research plan when context changes.
 * Called after document uploads, mission completions, etc.
 */
export async function reEvaluatePlan(
  dealId: string,
  triggerEvent: PlanTriggerEvent,
  triggerId?: string
): Promise<EvaluatePlanResult> {
  return evaluateResearchPlan({
    deal_id: dealId,
    trigger_event: triggerEvent,
    trigger_document_id: triggerEvent === "document_uploaded" ? triggerId : undefined,
    trigger_mission_id: triggerEvent === "mission_completed" ? triggerId : undefined,
  });
}
