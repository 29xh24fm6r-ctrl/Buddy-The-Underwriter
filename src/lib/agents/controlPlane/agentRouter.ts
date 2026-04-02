/**
 * Agent Router — Phase 66A Control Plane
 *
 * Routes agent requests to the correct agent based on:
 * - Channel (web, sms, email, api, internal)
 * - Visibility scope (banker, borrower, system, committee)
 * - Agent type and capability
 *
 * This is a ROUTING layer — it delegates execution to the existing
 * AgentOrchestrator and agent base classes. It does NOT replace them.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName, AgentContext, AgentFinding } from "../types";
import { AgentOrchestrator, agentRegistry } from "../orchestrator";
import { getAgentPolicy, type ChannelType, type VisibilityScope } from "./agentPolicies";
import { getOrCreateSession, updateSessionState } from "./agentSessionStore";

// ============================================================================
// Types
// ============================================================================

export type RouteRequest = {
  dealId: string;
  bankId: string;
  agentType: AgentName;
  channel: ChannelType;
  visibility: VisibilityScope;
  input?: unknown;
  userId?: string;
  sessionId?: string;
};

export type RouteResult = {
  ok: boolean;
  finding?: AgentFinding;
  sessionId: string;
  blocked?: boolean;
  blockReason?: string;
  error?: string;
};

// ============================================================================
// Router
// ============================================================================

const orchestrator = new AgentOrchestrator(agentRegistry);

/**
 * Route an agent request through the control plane.
 *
 * 1. Check policy (is this agent allowed for this channel/scope?)
 * 2. Get or create session
 * 3. Execute via existing orchestrator
 * 4. Update session state
 */
export async function routeAgentRequest(
  sb: SupabaseClient,
  request: RouteRequest,
): Promise<RouteResult> {
  // 1. Policy check
  const policy = getAgentPolicy(request.agentType, request.channel, request.visibility);

  if (!policy.allowed) {
    return {
      ok: false,
      sessionId: request.sessionId ?? "",
      blocked: true,
      blockReason: policy.reason,
    };
  }

  // 2. Get or create session
  const session = await getOrCreateSession(sb, {
    bankId: request.bankId,
    dealId: request.dealId,
    agentType: request.agentType,
    channel: request.channel,
    visibility: request.visibility,
  });

  if (!session) {
    return {
      ok: false,
      sessionId: "",
      error: "Failed to create agent session",
    };
  }

  // 3. Execute via orchestrator
  const context: AgentContext = {
    deal_id: request.dealId,
    bank_id: request.bankId,
    user_id: request.userId,
    session_id: session.id,
  };

  try {
    const finding = await orchestrator.executeAgent(
      request.agentType,
      request.input ?? { deal_id: request.dealId, bank_id: request.bankId },
      context,
    );

    // 4. Update session state
    await updateSessionState(sb, session.id, {
      last_agent_run: request.agentType,
      last_run_at: new Date().toISOString(),
      last_confidence: finding.confidence,
      last_status: finding.status,
    });

    return {
      ok: true,
      finding,
      sessionId: session.id,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));

    await updateSessionState(sb, session.id, {
      last_error: error.message,
      last_error_at: new Date().toISOString(),
    });

    return {
      ok: false,
      sessionId: session.id,
      error: error.message,
    };
  }
}

/**
 * Route a multi-agent pipeline through the control plane.
 * Delegates to AgentOrchestrator.executeAgents which handles dependency ordering.
 */
export async function routeAgentPipeline(
  sb: SupabaseClient,
  request: Omit<RouteRequest, "agentType"> & { agents: AgentName[] },
): Promise<{ ok: boolean; sessionId: string; results: RouteResult[] }> {
  const results: RouteResult[] = [];

  // Check all policies first
  for (const agent of request.agents) {
    const policy = getAgentPolicy(agent, request.channel, request.visibility);
    if (!policy.allowed) {
      results.push({
        ok: false,
        sessionId: "",
        blocked: true,
        blockReason: `${agent}: ${policy.reason}`,
      });
    }
  }

  if (results.some((r) => r.blocked)) {
    return { ok: false, sessionId: "", results };
  }

  // Execute the full pipeline via orchestrator
  const context: AgentContext = {
    deal_id: request.dealId,
    bank_id: request.bankId,
    user_id: request.userId,
  };

  const orchestrationResult = await orchestrator.executeAgents(request.agents, context);

  for (const finding of orchestrationResult.findings) {
    results.push({
      ok: true,
      finding,
      sessionId: orchestrationResult.session_id,
    });
  }

  for (const error of orchestrationResult.errors) {
    results.push({
      ok: false,
      sessionId: orchestrationResult.session_id,
      error: error.error,
    });
  }

  return {
    ok: orchestrationResult.errors.length === 0,
    sessionId: orchestrationResult.session_id,
    results,
  };
}
