/**
 * Agent Handoff — Phase 66B Agent Choreography
 *
 * Server module. Executes and persists agent-to-agent handoffs,
 * enforcing delegation policy and building scoped briefs.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName } from "./types";
import type { VisibilityScope } from "./controlPlane";
import type { TaskContract, HandoffType, HandoffResult } from "./agentTaskContracts";
import { validateContract } from "./agentTaskContracts";
import { canDelegate } from "./agentDelegationPolicy";
import { buildHandoffBrief, type HandoffBrief } from "./agentBriefBuilder";
import { agentHandoffRowToDomain, type AgentHandoffDomain, type AgentHandoffRow } from "@/lib/contracts/phase66b66cRowMappers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandoffInput {
  dealId: string;
  bankId: string;
  fromAgent: AgentName;
  toAgent: AgentName;
  visibility: VisibilityScope;
  handoffType: HandoffType;
  taskContract: TaskContract;
  payload?: Record<string, unknown>;
}

export type HandoffRecord = AgentHandoffDomain;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a handoff between two agents.
 *
 * 1. Validates the task contract.
 * 2. Checks delegation policy.
 * 3. Builds a scoped brief.
 * 4. Persists the handoff record.
 */
export async function executeHandoff(
  sb: SupabaseClient,
  input: HandoffInput,
): Promise<HandoffResult> {
  // 1. Validate contract
  const contractValidation = validateContract(input.taskContract);
  if (!contractValidation.valid) {
    return {
      ok: false,
      summary: { error: "Invalid task contract", details: contractValidation.errors },
      outputKeys: [],
      warnings: contractValidation.errors,
    };
  }

  // 2. Check delegation policy
  const delegation = canDelegate(input.fromAgent, input.toAgent, input.visibility);
  if (!delegation.allowed) {
    return {
      ok: false,
      summary: {
        error: "Delegation not allowed",
        from: input.fromAgent,
        to: input.toAgent,
        visibility: input.visibility,
        reason: delegation.reason,
      },
      outputKeys: [],
      warnings: [delegation.reason ?? "Delegation denied"],
    };
  }

  // 3. Build brief
  const brief = await buildHandoffBrief(sb, {
    dealId: input.dealId,
    bankId: input.bankId,
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    visibility: input.visibility,
    taskContract: input.taskContract,
  });

  // 4. Persist handoff record
  const handoffResult: HandoffResult = {
    ok: true,
    summary: {
      from: input.fromAgent,
      to: input.toAgent,
      visibility: input.visibility,
      handoffType: input.handoffType,
      redactedFieldCount: brief.redactedFields.length,
      constraintCount: brief.constraints.length,
    },
    outputKeys: input.taskContract.expectedOutputs,
    warnings: brief.redactedFields.length > 0
      ? [`${brief.redactedFields.length} field(s) redacted for ${input.visibility} visibility`]
      : undefined,
  };

  await sb.from("buddy_agent_handoffs").insert({
    deal_id: input.dealId,
    bank_id: input.bankId,
    from_agent_type: input.fromAgent,
    to_agent_type: input.toAgent,
    visibility_scope: input.visibility,
    handoff_type: input.handoffType,
    status: "complete",
    task_contract_json: {
      ...input.taskContract,
      brief,
    },
    result_summary_json: handoffResult.summary,
    completed_at: new Date().toISOString(),
  });

  return handoffResult;
}

/**
 * Retrieve all handoff records for a deal.
 */
export async function getHandoffsForDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<HandoffRecord[]> {
  const { data, error } = await sb
    .from("buddy_agent_handoffs")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[agentHandoff] getHandoffsForDeal failed", { dealId, error: error.message });
    return [];
  }
  if (!data) return [];
  return data.map((row: Record<string, unknown>) => agentHandoffRowToDomain(row as AgentHandoffRow));
}
