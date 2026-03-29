// Pure function. No DB. No side effects. No network.
import type { GuardrailInput, RelationshipAutonomyGuardrailResult } from "./types";
import {
  ALLOWED_AUTO_EXECUTE_ACTIONS,
  APPROVAL_REQUIRED_ACTIONS,
  MAX_ACTIONS_PER_PLAN,
} from "./relationshipAutonomyPolicy";

/**
 * Validate whether an autonomy plan may be staged/executed.
 * All checks are deterministic and evidence-based.
 *
 * Validation happens TWICE: at generation AND at execution.
 */
export function validateRelationshipAutonomyGuardrails(
  input: GuardrailInput,
): RelationshipAutonomyGuardrailResult {
  const errors: string[] = [];
  const blockedActionIds: string[] = [];

  // Feature flag
  if (!input.featureFlagEnabled) {
    errors.push("Autonomy feature is not enabled.");
    return { ok: false, errors, blockedActionIds: input.plan.actions.map((a) => a.id) };
  }

  // Kill switch
  if (input.killSwitchActive) {
    errors.push("Autonomy kill switch is active. All autonomous execution is blocked.");
    return { ok: false, errors, blockedActionIds: input.plan.actions.map((a) => a.id) };
  }

  // Mode check
  if (input.plan.mode === "manual") {
    errors.push("Autonomy mode is manual. No automated actions allowed.");
    return { ok: false, errors, blockedActionIds: input.plan.actions.map((a) => a.id) };
  }

  // Relationship must be active
  if (!input.relationshipActive) {
    errors.push("Relationship is not active.");
    return { ok: false, errors, blockedActionIds: input.plan.actions.map((a) => a.id) };
  }

  // Empty plan
  if (input.plan.actions.length === 0) {
    errors.push("Plan contains no actions.");
    return { ok: false, errors, blockedActionIds: [] };
  }

  // Max actions
  if (input.plan.actions.length > MAX_ACTIONS_PER_PLAN) {
    errors.push(`Plan exceeds maximum of ${MAX_ACTIONS_PER_PLAN} actions.`);
  }

  // Hard suppressors — block auto-execute
  const hasHardSuppressor =
    input.hasIntegrityFailure ||
    input.hasCriticalMonitoringException ||
    input.hasCryptoLiquidationReview ||
    input.hasCriticalProtectionCase ||
    input.hasRenewalPolicyHardStop;

  // Per-action validation
  for (const action of input.plan.actions) {
    // Check auto-execute eligibility
    if (action.executionMode === "auto_execute") {
      if (!ALLOWED_AUTO_EXECUTE_ACTIONS.has(action.actionType)) {
        errors.push(`Action "${action.actionType}" is not on the auto-execute whitelist.`);
        blockedActionIds.push(action.id);
        continue;
      }

      if (hasHardSuppressor) {
        errors.push(`Auto-execute blocked for "${action.actionType}": hard suppressor active.`);
        blockedActionIds.push(action.id);
        continue;
      }

      if (input.plan.mode !== "controlled_autonomy") {
        errors.push(`Auto-execute requires controlled_autonomy mode. Current: ${input.plan.mode}`);
        blockedActionIds.push(action.id);
      }
    }

    // Approval-required actions cannot be set to auto-execute
    if (
      APPROVAL_REQUIRED_ACTIONS.has(action.actionType) &&
      action.executionMode === "auto_execute"
    ) {
      errors.push(`Action "${action.actionType}" requires approval and cannot auto-execute.`);
      blockedActionIds.push(action.id);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    blockedActionIds,
  };
}
