/**
 * Recommendation narrative for memo/committee integration.
 * Pure module — no DB, no server-only.
 */

import type { StructuringScenario, PathToApprovalPlan } from "@/lib/structuring/types";

export type RecommendationNarrative = {
  recommended_structure: string;
  alternatives_considered: string;
  path_to_approval: string;
  banker_action_items: string;
};

export function generateRecommendationNarrative(
  bestScenario: StructuringScenario | null,
  allScenarios: StructuringScenario[],
  plan: PathToApprovalPlan | null,
): RecommendationNarrative {
  if (!bestScenario || allScenarios.length === 0) {
    return {
      recommended_structure: "No structuring recommendation available. Critical inputs may be missing.",
      alternatives_considered: "No alternative scenarios could be generated.",
      path_to_approval: "Resolve outstanding blockers before structuring advice is possible.",
      banker_action_items: "Review the readiness panel for missing inputs.",
    };
  }

  // Recommended structure
  const recParts: string[] = [];
  recParts.push(`Buddy recommends: ${bestScenario.summary}`);
  recParts.push(bestScenario.rationale);
  if (bestScenario.resolves_exception_keys.length > 0) {
    recParts.push(`This approach resolves ${bestScenario.resolves_exception_keys.length} active policy exception${bestScenario.resolves_exception_keys.length > 1 ? "s" : ""}.`);
  }
  if (bestScenario.remaining_exception_keys.length > 0) {
    recParts.push(`${bestScenario.remaining_exception_keys.length} exception${bestScenario.remaining_exception_keys.length > 1 ? "s" : ""} would remain.`);
  }

  // Alternatives
  const alternatives = allScenarios.filter((s) => s.id !== bestScenario.id);
  let altText: string;
  if (alternatives.length === 0) {
    altText = "No alternative scenarios were viable given current deal state.";
  } else {
    const altDescriptions = alternatives.map(
      (s) => `${s.label} (${s.path_type.replace(/_/g, " ")}, score: ${s.recommendation_score})`,
    );
    altText = `${alternatives.length} alternative scenario${alternatives.length > 1 ? "s" : ""} considered: ${altDescriptions.join("; ")}.`;
  }

  // Path to approval
  let pathText: string;
  if (plan) {
    const stepsText = plan.steps.map((s) => `${s.step_number}. ${s.action}`).join(" ");
    pathText = `${plan.headline}: ${stepsText} Projected outcome: ${plan.projected_outcome}`;
  } else {
    pathText = "Path to approval could not be determined.";
  }

  // Action items
  const actionItems: string[] = [];
  for (const action of bestScenario.actions) {
    switch (action.kind) {
      case "set_loan_amount":
        actionItems.push(`Update requested loan to $${action.to.toLocaleString()}`);
        break;
      case "set_equity_pct":
        actionItems.push(`Set equity injection to ${(action.to * 100).toFixed(0)}%`);
        break;
      case "require_additional_collateral":
        actionItems.push("Identify and pledge additional eligible collateral");
        break;
      case "require_valuation_upgrade":
        actionItems.push("Obtain formal appraisal or stronger valuation");
        break;
      case "proceed_with_exception":
        actionItems.push("Document mitigants and submit with exceptions");
        break;
      case "resolve_missing_input":
        actionItems.push(`Resolve: ${action.field_hint}`);
        break;
    }
  }

  return {
    recommended_structure: recParts.join(" "),
    alternatives_considered: altText,
    path_to_approval: pathText,
    banker_action_items: actionItems.length > 0
      ? `Action items: ${actionItems.join(". ")}.`
      : "No immediate action items.",
  };
}
