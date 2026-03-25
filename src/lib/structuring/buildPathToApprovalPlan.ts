/**
 * Convert the best-ranked structuring scenario into a banker-readable action plan.
 * Pure module — no DB, no server-only.
 */

import type { StructuringScenario, PathToApprovalPlan } from "./types";

export function buildPathToApprovalPlan(scenario: StructuringScenario): PathToApprovalPlan {
  const steps: PathToApprovalPlan["steps"] = [];
  let stepNum = 1;

  for (const action of scenario.actions) {
    switch (action.kind) {
      case "set_loan_amount":
        steps.push({
          step_number: stepNum++,
          action: `Reduce requested loan from $${(action.from ?? 0).toLocaleString()} to $${action.to.toLocaleString()}`,
          why_it_matters: "Brings LTV within policy limit based on current collateral support",
        });
        break;

      case "set_equity_pct":
        steps.push({
          step_number: stepNum++,
          action: `Increase equity injection from ${((action.from ?? 0) * 100).toFixed(0)}% to ${(action.to * 100).toFixed(0)}%`,
          why_it_matters: "Meets the minimum equity requirement per policy",
        });
        break;

      case "set_equity_amount":
        steps.push({
          step_number: stepNum++,
          action: `Increase equity injection to $${action.to.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
          why_it_matters: "Closes the equity shortfall gap",
        });
        break;

      case "require_additional_collateral":
        steps.push({
          step_number: stepNum++,
          action: `Identify and pledge $${action.additional_lendable_value_needed.toLocaleString(undefined, { maximumFractionDigits: 0 })} of additional lendable collateral`,
          why_it_matters: "Provides sufficient policy-adjusted collateral support for the requested loan amount",
        });
        break;

      case "require_valuation_upgrade":
        steps.push({
          step_number: stepNum++,
          action: `Obtain ${action.to_method_hint} for collateral item`,
          why_it_matters: "Strengthens valuation defensibility and may improve advance rate treatment",
        });
        break;

      case "proceed_with_exception":
        steps.push({
          step_number: stepNum++,
          action: `Document compensating factors for ${action.exception_keys.length} policy exception${action.exception_keys.length > 1 ? "s" : ""}`,
          why_it_matters: "Required for committee consideration of out-of-policy structure",
        });
        steps.push({
          step_number: stepNum++,
          action: "Submit as Credit Ready with Exceptions",
          why_it_matters: "Formal pathway for deals that cannot be restructured within policy",
        });
        break;

      case "resolve_missing_input":
        steps.push({
          step_number: stepNum++,
          action: `Resolve: ${action.field_hint}`,
          why_it_matters: "Required before a defensible structuring recommendation can be made",
        });
        break;
    }
  }

  // Projected outcome
  let projectedOutcome: string;
  switch (scenario.path_type) {
    case "inside_policy":
      projectedOutcome = "Deal becomes credit ready without policy exceptions.";
      break;
    case "ready_with_exceptions":
      projectedOutcome = "Deal may proceed as credit ready with documented exceptions requiring committee acceptance.";
      break;
    case "not_yet_ready":
      projectedOutcome = "Insufficient data for defensible structuring recommendation. Resolve blockers first.";
      break;
  }

  return {
    headline: scenario.label,
    path_type: scenario.path_type,
    steps,
    projected_outcome: projectedOutcome,
    recommendation_summary: scenario.rationale,
  };
}
