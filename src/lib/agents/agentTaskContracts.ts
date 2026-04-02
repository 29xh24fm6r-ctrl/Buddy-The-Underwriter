/**
 * Agent Task Contracts — Phase 66B Agent Choreography
 *
 * Pure types module defining the handoff contract schema between agents.
 */

import type { VisibilityScope } from "./controlPlane";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskContract {
  /** Human-readable purpose of this handoff. */
  purpose: string;
  /** Visibility scope the receiving agent is allowed to operate within. */
  allowedVisibility: VisibilityScope;
  /** Input keys the sending agent must provide. */
  requiredInputs: string[];
  /** Output keys the receiving agent must produce. */
  expectedOutputs: string[];
  /** How fresh the input data must be. */
  freshnessRequirement: "realtime" | "recent" | "any";
  /** Whether the handoff can be cancelled mid-execution. */
  cancellable: boolean;
  /** Fields that must be stripped before borrower-visible handoffs. */
  borrowerSafeRedactionRules: string[];
}

export type HandoffType =
  | "data_request"
  | "evidence_request"
  | "analysis_request"
  | "coaching_update"
  | "escalation"
  | "monitoring_alert";

export interface HandoffResult {
  ok: boolean;
  summary: Record<string, unknown>;
  outputKeys: string[];
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a TaskContract for structural completeness.
 */
export function validateContract(
  contract: TaskContract,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!contract.purpose || contract.purpose.trim().length === 0) {
    errors.push("purpose is required");
  }

  if (!contract.allowedVisibility) {
    errors.push("allowedVisibility is required");
  }

  if (!Array.isArray(contract.requiredInputs) || contract.requiredInputs.length === 0) {
    errors.push("requiredInputs must be a non-empty array");
  }

  if (!Array.isArray(contract.expectedOutputs) || contract.expectedOutputs.length === 0) {
    errors.push("expectedOutputs must be a non-empty array");
  }

  if (!["realtime", "recent", "any"].includes(contract.freshnessRequirement)) {
    errors.push("freshnessRequirement must be 'realtime', 'recent', or 'any'");
  }

  if (typeof contract.cancellable !== "boolean") {
    errors.push("cancellable must be a boolean");
  }

  if (!Array.isArray(contract.borrowerSafeRedactionRules)) {
    errors.push("borrowerSafeRedactionRules must be an array");
  }

  return { valid: errors.length === 0, errors };
}
