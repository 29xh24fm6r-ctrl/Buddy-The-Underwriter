// Pure function. No DB. No side effects. No network.
import type {
  EligibleActionsInput,
  RelationshipAutonomyAction,
  AutonomyActionType,
  AutonomyExecutionMode,
} from "./types";
import {
  ALLOWED_AUTO_EXECUTE_ACTIONS,
  APPROVAL_REQUIRED_ACTIONS,
  MAX_ACTIONS_PER_PLAN,
} from "./relationshipAutonomyPolicy";

/**
 * Map canonical actions + Omega suggestions into autonomy-safe action candidates.
 * Only produces actions from the allowed taxonomy. Never produces forbidden types.
 */
export function deriveAutonomyEligibleActions(
  input: EligibleActionsInput,
): RelationshipAutonomyAction[] {
  if (input.mode === "manual") return [];

  const actions: RelationshipAutonomyAction[] = [];
  let counter = 0;

  // From canonical primary action — create matching follow-up task
  if (input.primaryActionCode) {
    actions.push({
      id: `auto_${++counter}`,
      actionType: "create_internal_task",
      executionMode: resolveExecutionMode("create_internal_task", input.mode),
      relatedCanonicalActionCode: input.primaryActionCode,
      relatedReasonCode: input.primaryReasonCode,
      title: `Follow up: ${input.primaryActionCode.replace(/_/g, " ")}`,
      description: `Auto-generated follow-up task for canonical action: ${input.primaryActionCode}`,
      payload: { canonicalActionCode: input.primaryActionCode, relationshipId: input.relationshipId },
      evidence: [],
      reversible: true,
      riskTier: "low",
    });
  }

  // From Omega recommendations
  for (const rec of input.omegaRecommendations.slice(0, 3)) {
    const actionType = mapRecommendationToActionType(rec.action);
    if (!actionType) continue;

    actions.push({
      id: `auto_${++counter}`,
      actionType,
      executionMode: resolveExecutionMode(actionType, input.mode),
      relatedCanonicalActionCode: rec.relatedCanonicalAction ?? null,
      relatedReasonCode: input.primaryReasonCode,
      title: rec.action,
      description: `Omega-suggested: ${rec.action}`,
      payload: { omegaSuggestion: true, priority: rec.priority },
      evidence: [],
      reversible: isReversible(actionType),
      riskTier: getRiskTier(actionType),
    });
  }

  // Always suggest a review reminder if there are blockers
  if (input.primaryReasonCode && !actions.some((a) => a.actionType === "create_review_reminder")) {
    actions.push({
      id: `auto_${++counter}`,
      actionType: "create_review_reminder",
      executionMode: resolveExecutionMode("create_review_reminder", input.mode),
      relatedCanonicalActionCode: null,
      relatedReasonCode: input.primaryReasonCode,
      title: "Review reminder",
      description: `Schedule review for: ${input.primaryReasonCode.replace(/_/g, " ")}`,
      payload: { reasonCode: input.primaryReasonCode },
      evidence: [],
      reversible: true,
      riskTier: "low",
    });
  }

  return actions.slice(0, MAX_ACTIONS_PER_PLAN);
}

function resolveExecutionMode(
  actionType: AutonomyActionType,
  mode: string,
): AutonomyExecutionMode {
  if (mode === "assistive") return "draft_only";
  if (APPROVAL_REQUIRED_ACTIONS.has(actionType)) return "approval_required";
  if (mode === "controlled_autonomy" && ALLOWED_AUTO_EXECUTE_ACTIONS.has(actionType)) {
    return "auto_execute";
  }
  return "approval_required";
}

function mapRecommendationToActionType(action: string): AutonomyActionType | null {
  const lower = action.toLowerCase();
  if (lower.includes("borrower") && (lower.includes("message") || lower.includes("outreach") || lower.includes("follow"))) {
    return "draft_borrower_message";
  }
  if (lower.includes("internal") && lower.includes("note")) return "draft_internal_note";
  if (lower.includes("reminder") || lower.includes("review")) return "create_review_reminder";
  if (lower.includes("task") || lower.includes("follow")) return "create_internal_task";
  if (lower.includes("refresh")) return "request_surface_refresh";
  return "create_internal_task"; // safe fallback
}

function isReversible(actionType: AutonomyActionType): boolean {
  return actionType !== "resend_borrower_reminder";
}

function getRiskTier(actionType: AutonomyActionType): "low" | "medium" | "high" {
  if (ALLOWED_AUTO_EXECUTE_ACTIONS.has(actionType)) return "low";
  if (APPROVAL_REQUIRED_ACTIONS.has(actionType)) return "medium";
  return "low";
}
