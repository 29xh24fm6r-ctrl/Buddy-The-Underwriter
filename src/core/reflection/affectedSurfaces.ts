/**
 * Affected Surfaces Map — Phase 64
 *
 * Canonical mapping from action keys to surfaces that must refresh
 * after that action completes. Used by invalidation and receipts.
 */

import type { AffectedSurfaceKey } from "./types";

const AFFECTED_SURFACES_MAP: Record<string, AffectedSurfaceKey[]> = {
  // ── Committee decisions ──────────────────────────────────
  "committee.decision.approved": [
    "credit_committee_view",
    "deals_command_bridge",
    "portfolio",
    "pricing_memo_command_center",
    "deal_intake",
  ],
  "committee.decision.declined": [
    "credit_committee_view",
    "deals_command_bridge",
    "portfolio",
    "deal_intake",
  ],
  "committee.decision.escalated": [
    "credit_committee_view",
    "deals_command_bridge",
    "portfolio",
  ],

  // ── Exception decisions ──────────────────────────────────
  "exception.decision.approve": [
    "exceptions_change_review",
    "deals_command_bridge",
    "portfolio",
  ],
  "exception.decision.reject": [
    "exceptions_change_review",
    "deals_command_bridge",
    "portfolio",
  ],
  "exception.decision.escalate": [
    "exceptions_change_review",
    "credit_committee_view",
    "deals_command_bridge",
    "portfolio",
  ],

  // ── Pricing decisions ────────────────────────────────────
  "pricing.decision.made": [
    "pricing_memo_command_center",
    "deals_command_bridge",
    "credit_committee_view",
    "portfolio",
  ],
  "pricing.commit.approved": [
    "pricing_memo_command_center",
    "deals_command_bridge",
    "portfolio",
  ],
  "pricing.commit.locked": [
    "pricing_memo_command_center",
    "deals_command_bridge",
  ],

  // ── Checklist / borrower task mutations ───────────────────
  "checklist.status.set": [
    "borrower_task_inbox",
    "borrower_portal",
    "deals_command_bridge",
    "deal_intake",
  ],
  "borrower.task.completed": [
    "borrower_task_inbox",
    "borrower_portal",
    "deals_command_bridge",
    "deal_intake",
  ],

  // ── Deal stage transitions ───────────────────────────────
  "deal.state.transitioned": [
    "deals_command_bridge",
    "portfolio",
    "deal_intake",
    "credit_committee_view",
  ],
};

/**
 * Get surfaces affected by a given action key.
 * Returns empty array for unknown action keys.
 */
export function getAffectedSurfaces(actionKey: string): AffectedSurfaceKey[] {
  return AFFECTED_SURFACES_MAP[actionKey] ?? [];
}

/**
 * Get all declared action keys that have affected surface mappings.
 */
export function getAllMappedActionKeys(): string[] {
  return Object.keys(AFFECTED_SURFACES_MAP);
}

/**
 * Check if a specific surface is affected by an action key.
 */
export function isSurfaceAffected(
  actionKey: string,
  surfaceKey: AffectedSurfaceKey,
): boolean {
  return (AFFECTED_SURFACES_MAP[actionKey] ?? []).includes(surfaceKey);
}
