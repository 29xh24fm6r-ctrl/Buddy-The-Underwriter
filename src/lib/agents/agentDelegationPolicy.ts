/**
 * Agent Delegation Policy — Phase 66B Agent Choreography
 *
 * Pure policy engine. Determines which agents can delegate to which,
 * and under what visibility constraints.
 */

import type { AgentName } from "./types";
import type { VisibilityScope } from "./controlPlane";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegationRule {
  from: AgentName;
  to: AgentName;
  visibility: VisibilityScope;
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------

/**
 * Explicit delegation rules. Rules are evaluated top-to-bottom; the first
 * match wins. A trailing implicit-deny applies.
 */
export const DELEGATION_RULES: DelegationRule[] = [
  // banker_copilot can delegate to any agent with banker visibility
  { from: "banker_copilot", to: "sba_policy",   visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "eligibility",   visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "credit",        visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "cash_flow",     visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "collateral",    visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "management",    visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "risk",          visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "narrative",     visibility: "banker", allowed: true },
  { from: "banker_copilot", to: "evidence",      visibility: "banker", allowed: true },

  // risk agent can delegate to evidence for evidence requests
  { from: "risk", to: "evidence", visibility: "banker", allowed: true, reason: "Risk agent may request evidence gathering" },
  { from: "risk", to: "evidence", visibility: "system", allowed: true, reason: "Risk agent may request evidence gathering in system scope" },

  // Monitoring signals → borrower coaching updates
  { from: "risk",      to: "narrative", visibility: "borrower", allowed: true, reason: "Monitoring signals can create coaching updates for borrower" },
  { from: "narrative", to: "evidence",  visibility: "borrower", allowed: true, reason: "Narrative agent may request borrower-visible evidence" },

  // Borrower-visible agents can NEVER receive banker-only rationale
  { from: "banker_copilot", to: "narrative",  visibility: "borrower", allowed: false, reason: "Borrower-visible agents cannot receive banker-only rationale" },
  { from: "banker_copilot", to: "evidence",   visibility: "borrower", allowed: false, reason: "Borrower-visible agents cannot receive banker-only rationale" },
  { from: "credit",         to: "narrative",  visibility: "borrower", allowed: false, reason: "Borrower-visible agents cannot receive banker-only credit details" },
  { from: "risk",           to: "cash_flow",  visibility: "borrower", allowed: false, reason: "Cannot send banker-only risk data to borrower-visible scope" },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Determine whether a delegation from one agent to another at a given
 * visibility scope is allowed.
 */
export function canDelegate(
  from: AgentName,
  to: AgentName,
  visibility: VisibilityScope,
): { allowed: boolean; reason?: string } {
  // Find the first matching rule.
  for (const rule of DELEGATION_RULES) {
    if (rule.from === from && rule.to === to && rule.visibility === visibility) {
      return { allowed: rule.allowed, reason: rule.reason };
    }
  }

  // Implicit deny: no rule matched.
  return {
    allowed: false,
    reason: `No delegation rule found for ${from} -> ${to} at visibility ${visibility}`,
  };
}
