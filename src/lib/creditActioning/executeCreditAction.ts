import "server-only";

/**
 * Phase 55G — Credit Action Execution
 *
 * Converts accepted recommendations into real target-system records.
 * Every accepted action must end in created/updated/already_exists/failed.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

type ExecutionInput = {
  actionId: string;
  dealId: string;
  bankId: string;
  actionType: string;
  recommendedText: string;
  proposedTerms: Record<string, unknown>;
  category: string;
  executedBy: string;
};

type ExecutionResult = {
  ok: true;
  targetSystem: string;
  targetRecordId: string | null;
  executionStatus: "created" | "updated" | "already_exists";
} | {
  ok: false;
  error: string;
};

/**
 * Execute an accepted credit action into its target system.
 * Idempotent — checks for existing execution before creating.
 */
export async function executeCreditAction(input: ExecutionInput): Promise<ExecutionResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  try {
    // Check for existing execution (idempotency)
    const { data: existing } = await sb
      .from("deal_action_executions")
      .select("id, target_record_id, execution_status")
      .eq("action_id", input.actionId)
      .eq("deal_id", input.dealId)
      .eq("execution_status", "created")
      .maybeSingle();

    if (existing) {
      return { ok: true, targetSystem: "existing", targetRecordId: existing.target_record_id, executionStatus: "already_exists" };
    }

    // Route to target system
    const result = await routeToTargetSystem(sb, input);

    // Record execution
    const targetSys = result.ok ? result.targetSystem : "unknown";
    const targetId = result.ok ? result.targetRecordId : null;
    const execStatus = result.ok ? "created" : "failed";
    const execError = result.ok ? null : (result as any).error;

    await sb.from("deal_action_executions").insert({
      deal_id: input.dealId,
      action_id: input.actionId,
      target_system: targetSys,
      target_record_id: targetId,
      execution_status: execStatus,
      executed_by: input.executedBy,
      executed_at: now,
      error_text: execError,
    });

    // Update recommendation status
    if (result.ok) {
      await sb
        .from("credit_action_recommendations")
        .update({ status: "implemented", target_system: targetSys, target_record_id: targetId, updated_at: now })
        .eq("id", input.actionId);
    }

    // Audit
    await logLedgerEvent({
      dealId: input.dealId,
      bankId: input.bankId,
      eventKey: `credit_action.executed`,
      uiState: "done",
      uiMessage: `Credit action executed: ${input.actionType}`,
      meta: {
        action_id: input.actionId,
        action_type: input.actionType,
        target_system: targetSys,
        target_record_id: targetId,
        execution_status: execStatus,
      },
    }).catch(() => {});

    if (!result.ok) return result;
    return result;
  } catch (err) {
    // Record failure
    try {
      await sb.from("deal_action_executions").insert({
        deal_id: input.dealId,
        action_id: input.actionId,
        target_system: "unknown",
        execution_status: "failed",
        executed_by: input.executedBy,
        executed_at: now,
        error_text: err instanceof Error ? err.message : String(err),
      });
    } catch { /* non-fatal */ }

    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function routeToTargetSystem(
  sb: ReturnType<typeof supabaseAdmin>,
  input: ExecutionInput,
): Promise<ExecutionResult> {
  const { dealId, actionType, recommendedText, proposedTerms, category } = input;

  switch (actionType) {
    case "add_condition":
    case "request_updated_financials":
    case "request_supporting_document":
    case "add_collateral_support":
    case "add_guaranty_support": {
      const { data: cond } = await sb
        .from("deal_conditions")
        .insert({
          deal_id: dealId,
          bank_id: input.bankId,
          title: recommendedText,
          description: (proposedTerms as any)?.conditionText ?? recommendedText,
          category: mapConditionCategory(category),
          source: "system",
          status: "open",
        })
        .select("id")
        .single();
      return { ok: true, targetSystem: "conditions", targetRecordId: cond?.id ?? null, executionStatus: "created" };
    }

    case "add_covenant": {
      const { data: cov } = await sb
        .from("deal_covenants")
        .insert({
          deal_id: dealId,
          metric: (proposedTerms as any)?.covenantMetric ?? "TBD",
          threshold: String((proposedTerms as any)?.threshold ?? "TBD"),
          testing_frequency: (proposedTerms as any)?.testingFrequency ?? "annually",
          source_action_id: input.actionId,
          status: "proposed",
        })
        .select("id")
        .single();
      return { ok: true, targetSystem: "covenants", targetRecordId: cov?.id ?? null, executionStatus: "created" };
    }

    case "add_reporting_requirement": {
      const { data: rr } = await sb
        .from("deal_reporting_requirements")
        .insert({
          deal_id: dealId,
          requirement: (proposedTerms as any)?.reportingRequirement ?? recommendedText,
          frequency: (proposedTerms as any)?.testingFrequency ?? "quarterly",
          source_action_id: input.actionId,
          status: "proposed",
        })
        .select("id")
        .single();
      return { ok: true, targetSystem: "reporting", targetRecordId: rr?.id ?? null, executionStatus: "created" };
    }

    case "monitoring_recommendation": {
      const { data: ms } = await sb
        .from("deal_monitoring_seeds")
        .insert({
          deal_id: dealId,
          type: category,
          description: recommendedText,
          source_action_id: input.actionId,
          status: "seeded",
        })
        .select("id")
        .single();
      return { ok: true, targetSystem: "monitoring", targetRecordId: ms?.id ?? null, executionStatus: "created" };
    }

    case "pricing_review":
    case "structure_review":
    case "committee_discussion_item":
    case "memo_regeneration_required":
    case "packet_regeneration_required":
      // These create tracked tasks via the action execution record itself
      return { ok: true, targetSystem: actionType.replace(/_/g, "-"), targetRecordId: null, executionStatus: "created" };

    default:
      return { ok: true, targetSystem: "advisory", targetRecordId: null, executionStatus: "created" };
  }
}

function mapConditionCategory(cat: string): string {
  if (cat === "collateral") return "closing";
  if (cat === "guarantor") return "closing";
  return "credit";
}
