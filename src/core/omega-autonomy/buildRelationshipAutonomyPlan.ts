// Pure function. No DB. No side effects. No network.
import type {
  RelationshipAutonomyPlan,
  RelationshipAutonomyMode,
  EligibleActionsInput,
} from "./types";
import { deriveAutonomyEligibleActions } from "./deriveAutonomyEligibleActions";

/**
 * Build a bounded autonomy plan from canonical surface + Omega context.
 * Returns null for manual mode.
 */
export function buildRelationshipAutonomyPlan(input: {
  relationshipId: string;
  bankId: string;
  mode: RelationshipAutonomyMode;
  canonicalState: string;
  primaryReasonCode: string;
  primaryActionCode: string | null;
  omegaRecommendations: Array<{
    action: string;
    relatedCanonicalAction?: string;
    priority: string;
  }>;
  nowIso: string;
}): RelationshipAutonomyPlan | null {
  if (input.mode === "manual") return null;

  const eligibleInput: EligibleActionsInput = {
    mode: input.mode,
    canonicalState: input.canonicalState,
    primaryReasonCode: input.primaryReasonCode,
    primaryActionCode: input.primaryActionCode,
    omegaRecommendations: input.omegaRecommendations,
    relationshipId: input.relationshipId,
  };

  const actions = deriveAutonomyEligibleActions(eligibleInput);

  if (actions.length === 0) return null;

  const requiresApproval =
    input.mode !== "controlled_autonomy" ||
    actions.some((a) => a.executionMode === "approval_required");

  return {
    relationshipId: input.relationshipId,
    bankId: input.bankId,
    mode: input.mode,
    generatedAt: input.nowIso,
    source: {
      canonicalState: input.canonicalState,
      primaryReasonCode: input.primaryReasonCode,
      primaryActionCode: input.primaryActionCode,
      omegaUsed: input.omegaRecommendations.length > 0,
    },
    actions,
    rationale: buildRationale(input),
    requiresApproval,
  };
}

function buildRationale(input: {
  primaryReasonCode: string;
  primaryActionCode: string | null;
  omegaRecommendations: Array<{ action: string }>;
}): string[] {
  const rationale: string[] = [];
  rationale.push(
    `Canonical reason: ${input.primaryReasonCode.replace(/_/g, " ")}`,
  );
  if (input.primaryActionCode) {
    rationale.push(
      `Primary action: ${input.primaryActionCode.replace(/_/g, " ")}`,
    );
  }
  if (input.omegaRecommendations.length > 0) {
    rationale.push(
      `Omega suggested ${input.omegaRecommendations.length} recommendation(s)`,
    );
  }
  return rationale;
}
