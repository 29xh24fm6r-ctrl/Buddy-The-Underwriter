/**
 * Phase 55F — Credit Action Priority Scorer
 *
 * Deterministic priority assignment based on severity, action type, and stage.
 * Pure function — no DB calls.
 */

import type { CreditActionType, ActionPriority } from "./credit-action-types";

type PriorityInput = {
  actionType: CreditActionType;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  isPostMemo: boolean;
  isPreCommittee: boolean;
};

/**
 * Score priority for a credit action recommendation.
 */
export function scoreCreditActionPriority(input: PriorityInput): ActionPriority {
  const { actionType, severity, isPostMemo, isPreCommittee } = input;

  // Immediate: memo/packet regeneration, critical blocking issues
  if (actionType === "memo_regeneration_required") return "immediate";
  if (actionType === "packet_regeneration_required") return "immediate";
  if (severity === "critical") return "immediate";

  // Pre-committee: high-severity structural/pricing/committee items
  if (isPreCommittee && severity === "high") return "pre_committee";
  if (actionType === "pricing_review") return "pre_committee";
  if (actionType === "structure_review") return "pre_committee";
  if (actionType === "committee_discussion_item") return "pre_committee";
  if (actionType === "add_covenant" && severity === "high") return "pre_committee";

  // Pre-close: conditions, collateral, guaranty, reporting
  if (actionType === "add_condition") return "pre_close";
  if (actionType === "add_collateral_support") return "pre_close";
  if (actionType === "add_guaranty_support") return "pre_close";
  if (actionType === "request_updated_financials") return "pre_close";
  if (actionType === "request_supporting_document") return "pre_close";

  // Post-close: monitoring, low-priority covenants/reporting
  if (actionType === "monitoring_recommendation") return "post_close";
  if (actionType === "add_reporting_requirement" && severity !== "high") return "post_close";
  if (actionType === "add_covenant" && severity !== "high") return "post_close";

  // Default
  return severity === "high" ? "pre_committee" : "pre_close";
}
