/**
 * Agent Control Plane — Phase 66A
 *
 * Public API for the multi-agent control plane.
 * Provides routing, policy enforcement, and session management.
 */

export { routeAgentRequest, routeAgentPipeline } from "./agentRouter";
export { getAgentPolicy, getAgentPolicySummary } from "./agentPolicies";
export type { ChannelType, VisibilityScope, AgentPolicy } from "./agentPolicies";
export {
  getOrCreateSession,
  updateSessionState,
  completeSession,
  expireStaleSessions,
  getDealSessions,
} from "./agentSessionStore";
export type { AgentSession } from "./agentSessionStore";
