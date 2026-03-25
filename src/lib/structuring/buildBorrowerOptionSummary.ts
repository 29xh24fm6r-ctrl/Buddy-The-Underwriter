/**
 * Internal borrower option summary builder.
 * Produces simplified recommendation text for future borrower advisory workflows.
 * NOT for external use yet — internal banker reference only.
 * Pure module — no DB, no server-only.
 */

import type { StructuringScenario, BorrowerOptionSummary } from "./types";

export function buildBorrowerOptionSummary(scenario: StructuringScenario): BorrowerOptionSummary {
  const changes: string[] = [];

  for (const action of scenario.actions) {
    switch (action.kind) {
      case "set_loan_amount":
        changes.push(`Adjust loan request to $${action.to.toLocaleString()}`);
        break;
      case "set_equity_pct":
        changes.push(`Increase equity contribution to ${(action.to * 100).toFixed(0)}%`);
        break;
      case "set_equity_amount":
        changes.push(`Increase equity contribution to $${action.to.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        break;
      case "require_additional_collateral":
        changes.push(`Provide additional collateral support (approx. $${action.additional_lendable_value_needed.toLocaleString(undefined, { maximumFractionDigits: 0 })} eligible value)`);
        break;
      case "require_valuation_upgrade":
        changes.push("Provide formal appraisal or valuation support for pledged collateral");
        break;
      case "proceed_with_exception":
        changes.push("No structural changes required — bank will document policy exception");
        break;
      case "resolve_missing_input":
        changes.push(`Provide: ${action.field_hint}`);
        break;
    }
  }

  return {
    plain_language_summary: scenario.summary,
    required_changes: changes,
    not_for_external_use_yet: true,
  };
}
