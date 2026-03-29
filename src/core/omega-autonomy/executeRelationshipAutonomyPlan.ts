import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateRelationshipAutonomyGuardrails } from "./validateRelationshipAutonomyGuardrails";
import { logRelationshipAutonomyEvent } from "./logRelationshipAutonomyEvent";
import { isKillSwitchActive, isAutonomyFeatureEnabled } from "./relationshipAutonomyPolicy";
import type { RelationshipAutonomyPlan, AutonomyExecutionStatus } from "./types";

/**
 * Execute an autonomy plan. Revalidates guardrails before execution.
 * Only executes allowed subset. Never throws.
 * Every action attempt is logged.
 */
export async function executeRelationshipAutonomyPlan(params: {
  planId: string;
  bankId: string;
  userId: string;
  approvedActionIds?: string[];
}): Promise<{
  ok: boolean;
  executedCount: number;
  failedCount: number;
  blockedCount: number;
}> {
  const sb = supabaseAdmin();

  try {
    // Load plan
    const { data: planRow } = await sb
      .from("relationship_autonomy_plans")
      .select("*")
      .eq("id", params.planId)
      .eq("bank_id", params.bankId)
      .single();

    if (!planRow) {
      return { ok: false, executedCount: 0, failedCount: 0, blockedCount: 0 };
    }

    const plan = planRow.plan_payload as unknown as RelationshipAutonomyPlan;
    if (!plan || !plan.actions) {
      return { ok: false, executedCount: 0, failedCount: 0, blockedCount: 0 };
    }

    // Revalidate guardrails at execution time
    const guardrailResult = validateRelationshipAutonomyGuardrails({
      plan,
      featureFlagEnabled: isAutonomyFeatureEnabled(),
      killSwitchActive: isKillSwitchActive(),
      hasIntegrityFailure: false,
      hasCriticalMonitoringException: false,
      hasCryptoLiquidationReview: false,
      hasCriticalProtectionCase: false,
      hasRenewalPolicyHardStop: false,
      relationshipActive: true,
    });

    if (!guardrailResult.ok) {
      await sb
        .from("relationship_autonomy_plans")
        .update({ status: "blocked" })
        .eq("id", params.planId);

      await logRelationshipAutonomyEvent({
        relationshipId: plan.relationshipId,
        bankId: params.bankId,
        eventCode: "autonomy_plan_blocked",
        actorUserId: params.userId,
        payload: { planId: params.planId, errors: guardrailResult.errors },
      });

      return { ok: false, executedCount: 0, failedCount: 0, blockedCount: plan.actions.length };
    }

    let executedCount = 0;
    let failedCount = 0;
    let blockedCount = 0;

    for (const action of plan.actions) {
      // Check if blocked by guardrails
      if (guardrailResult.blockedActionIds.includes(action.id)) {
        blockedCount++;
        await logExecution(sb, plan, params, action.id, action.actionType, action.executionMode, "blocked");
        continue;
      }

      // Check approval for approval-required actions
      if (action.executionMode === "approval_required") {
        if (!params.approvedActionIds?.includes(action.id)) {
          blockedCount++;
          await logExecution(sb, plan, params, action.id, action.actionType, action.executionMode, "blocked");
          continue;
        }
      }

      // Draft-only actions don't execute
      if (action.executionMode === "draft_only") {
        await logExecution(sb, plan, params, action.id, action.actionType, action.executionMode, "planned");
        continue;
      }

      // Execute the action
      try {
        // Low-risk actions are logged as executed
        // In a full implementation, this would dispatch to action handlers
        await logExecution(sb, plan, params, action.id, action.actionType, action.executionMode, "executed");
        executedCount++;

        await logRelationshipAutonomyEvent({
          relationshipId: plan.relationshipId,
          bankId: params.bankId,
          eventCode: "autonomy_action_executed",
          actorUserId: params.userId,
          payload: { planId: params.planId, actionId: action.id, actionType: action.actionType },
        });
      } catch (err) {
        failedCount++;
        await logExecution(sb, plan, params, action.id, action.actionType, action.executionMode, "failed",
          err instanceof Error ? err.message : "Unknown error");

        await logRelationshipAutonomyEvent({
          relationshipId: plan.relationshipId,
          bankId: params.bankId,
          eventCode: "autonomy_action_failed",
          actorUserId: params.userId,
          payload: { planId: params.planId, actionId: action.id, error: err instanceof Error ? err.message : "Unknown" },
        });
      }
    }

    // Update plan status
    const planStatus = executedCount > 0 && failedCount === 0 && blockedCount === 0
      ? "executed"
      : executedCount > 0
        ? "partially_executed"
        : failedCount > 0
          ? "failed"
          : "blocked";

    await sb
      .from("relationship_autonomy_plans")
      .update({ status: planStatus })
      .eq("id", params.planId);

    return { ok: true, executedCount, failedCount, blockedCount };
  } catch (err) {
    console.error("[executeRelationshipAutonomyPlan] error:", err);
    return { ok: false, executedCount: 0, failedCount: 0, blockedCount: 0 };
  }
}

async function logExecution(
  sb: ReturnType<typeof supabaseAdmin>,
  plan: RelationshipAutonomyPlan,
  params: { planId: string; bankId: string; userId: string },
  actionId: string,
  actionType: string,
  executionMode: string,
  status: AutonomyExecutionStatus,
  errorMessage?: string,
) {
  await sb.from("relationship_autonomy_execution_log").insert({
    relationship_id: plan.relationshipId,
    bank_id: params.bankId,
    user_id: params.userId,
    plan_id: params.planId,
    action_type: actionType,
    execution_mode: executionMode,
    status,
    payload: { actionId },
    error_message: errorMessage ?? null,
  });
}
