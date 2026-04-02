/**
 * Agent Policies — Phase 66A Control Plane
 *
 * Permission and tool gating for agents.
 * Controls which agents can run in which channels and visibility scopes.
 *
 * This is a POLICY layer — it does NOT store state or duplicate
 * BuddyCanonicalState / OmegaAdvisoryState.
 */

import type { AgentName } from "../types";

// ============================================================================
// Types
// ============================================================================

export type ChannelType = "web" | "sms" | "email" | "api" | "internal";

export type VisibilityScope = "banker" | "borrower" | "system" | "committee";

export type AgentPolicy = {
  allowed: boolean;
  reason?: string;
  maxExecutionsPerHour?: number;
  requiresHumanApproval?: boolean;
  allowedTools?: string[];
  deniedTools?: string[];
};

type PolicyRule = {
  agent: AgentName | "*";
  channel: ChannelType | "*";
  visibility: VisibilityScope | "*";
  policy: AgentPolicy;
};

// ============================================================================
// Policy Rules
// ============================================================================

/**
 * Policy rules evaluated in order — first match wins.
 */
const POLICY_RULES: PolicyRule[] = [
  // Borrower visibility: only banker_copilot and borrower_insights allowed
  {
    agent: "banker_copilot",
    channel: "*",
    visibility: "borrower",
    policy: { allowed: false, reason: "Banker copilot not visible to borrowers" },
  },
  {
    agent: "risk",
    channel: "*",
    visibility: "borrower",
    policy: { allowed: false, reason: "Risk assessment not visible to borrowers" },
  },
  {
    agent: "sba_policy",
    channel: "*",
    visibility: "borrower",
    policy: { allowed: false, reason: "SBA policy checks not visible to borrowers" },
  },

  // SMS channel: limited agent set (no heavy compute agents)
  {
    agent: "narrative",
    channel: "sms",
    visibility: "*",
    policy: { allowed: false, reason: "Narrative generation too heavy for SMS" },
  },
  {
    agent: "evidence",
    channel: "sms",
    visibility: "*",
    policy: { allowed: false, reason: "Evidence verification too heavy for SMS" },
  },

  // Committee visibility: all agents allowed but require human approval
  {
    agent: "*",
    channel: "*",
    visibility: "committee",
    policy: { allowed: true, requiresHumanApproval: true },
  },

  // System visibility: all agents, no restrictions (internal automation)
  {
    agent: "*",
    channel: "internal",
    visibility: "system",
    policy: { allowed: true },
  },

  // Rate limits for external channels
  {
    agent: "*",
    channel: "api",
    visibility: "*",
    policy: { allowed: true, maxExecutionsPerHour: 100 },
  },

  // Default: allow
  {
    agent: "*",
    channel: "*",
    visibility: "*",
    policy: { allowed: true },
  },
];

// ============================================================================
// Policy Evaluation
// ============================================================================

/**
 * Get the effective policy for an agent + channel + visibility combination.
 * First matching rule wins.
 */
export function getAgentPolicy(
  agent: AgentName,
  channel: ChannelType,
  visibility: VisibilityScope,
): AgentPolicy {
  for (const rule of POLICY_RULES) {
    const agentMatch = rule.agent === "*" || rule.agent === agent;
    const channelMatch = rule.channel === "*" || rule.channel === channel;
    const visibilityMatch = rule.visibility === "*" || rule.visibility === visibility;

    if (agentMatch && channelMatch && visibilityMatch) {
      return rule.policy;
    }
  }

  // Fallback: allow (should never reach here due to wildcard default)
  return { allowed: true };
}

/**
 * Get all policies for an agent across channels/scopes.
 * Useful for admin dashboard display.
 */
export function getAgentPolicySummary(agent: AgentName): {
  channel: ChannelType;
  visibility: VisibilityScope;
  policy: AgentPolicy;
}[] {
  const channels: ChannelType[] = ["web", "sms", "email", "api", "internal"];
  const scopes: VisibilityScope[] = ["banker", "borrower", "system", "committee"];

  const results: { channel: ChannelType; visibility: VisibilityScope; policy: AgentPolicy }[] = [];

  for (const channel of channels) {
    for (const visibility of scopes) {
      results.push({
        channel,
        visibility,
        policy: getAgentPolicy(agent, channel, visibility),
      });
    }
  }

  return results;
}
