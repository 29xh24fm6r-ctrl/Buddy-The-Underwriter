/**
 * Agent Session Store — Phase 66A Control Plane
 *
 * Manages agent session state in buddy_agent_sessions.
 *
 * CRITICAL BOUNDARY: This store manages AGENT-LOCAL session state only:
 * - Tool bindings and permissions
 * - Conversation context within a session
 * - Last execution timestamps
 *
 * It does NOT store or duplicate:
 * - Deal lifecycle state (owned by BuddyCanonicalState in src/core/state/)
 * - Advisory intelligence (owned by OmegaAdvisoryState in src/core/omega/)
 * - Agent findings (owned by agent_findings table via Agent.saveFinding)
 *
 * Agents that need deal state MUST read it from BuddyCanonicalState.
 * Agents that need advisory context MUST read it from OmegaAdvisoryState.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName } from "../types";
import type { ChannelType, VisibilityScope } from "./agentPolicies";

// ============================================================================
// Types
// ============================================================================

export type AgentSession = {
  id: string;
  bank_id: string;
  deal_id: string;
  agent_type: string;
  channel_type: ChannelType;
  visibility_scope: VisibilityScope;
  session_state_json: Record<string, unknown>;
  memory_pointer_json: Record<string, unknown>;
  status: "active" | "suspended" | "completed" | "expired";
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

// ============================================================================
// Get or Create Session
// ============================================================================

/**
 * Get an existing active session or create a new one.
 * Scoped by (bank_id, deal_id, agent_type, channel_type).
 */
export async function getOrCreateSession(
  sb: SupabaseClient,
  input: {
    bankId: string;
    dealId: string;
    agentType: AgentName | string;
    channel: ChannelType;
    visibility: VisibilityScope;
  },
): Promise<AgentSession | null> {
  // Try to find an active session
  const { data: existing } = await sb
    .from("buddy_agent_sessions")
    .select("*")
    .eq("bank_id", input.bankId)
    .eq("deal_id", input.dealId)
    .eq("agent_type", input.agentType)
    .eq("channel_type", input.channel)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return existing as AgentSession;
  }

  // Create new session
  const { data, error } = await sb
    .from("buddy_agent_sessions")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      agent_type: input.agentType,
      channel_type: input.channel,
      visibility_scope: input.visibility,
      session_state_json: {},
      memory_pointer_json: {},
      status: "active",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[agentSessionStore] create failed", { input, error });
    return null;
  }

  return data as AgentSession;
}

// ============================================================================
// Update Session State
// ============================================================================

/**
 * Merge new state into the session's session_state_json.
 * This is a shallow merge — existing keys are preserved unless overwritten.
 */
export async function updateSessionState(
  sb: SupabaseClient,
  sessionId: string,
  stateUpdate: Record<string, unknown>,
): Promise<void> {
  const { data: current } = await sb
    .from("buddy_agent_sessions")
    .select("session_state_json")
    .eq("id", sessionId)
    .single();

  if (!current) return;

  const merged = {
    ...(current.session_state_json as Record<string, unknown>),
    ...stateUpdate,
  };

  await sb
    .from("buddy_agent_sessions")
    .update({ session_state_json: merged })
    .eq("id", sessionId);
}

// ============================================================================
// Session Lifecycle
// ============================================================================

/**
 * Mark a session as completed.
 */
export async function completeSession(
  sb: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await sb
    .from("buddy_agent_sessions")
    .update({ status: "completed" })
    .eq("id", sessionId);
}

/**
 * Expire stale sessions (no update for > threshold).
 */
export async function expireStaleSessions(
  sb: SupabaseClient,
  staleThresholdMs: number = 24 * 60 * 60 * 1000, // 24 hours
): Promise<number> {
  const threshold = new Date(Date.now() - staleThresholdMs).toISOString();

  const { data } = await sb
    .from("buddy_agent_sessions")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("updated_at", threshold)
    .select("id");

  return data?.length ?? 0;
}

/**
 * Get all active sessions for a deal.
 */
export async function getDealSessions(
  sb: SupabaseClient,
  dealId: string,
): Promise<AgentSession[]> {
  const { data } = await sb
    .from("buddy_agent_sessions")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  return (data ?? []) as AgentSession[];
}
