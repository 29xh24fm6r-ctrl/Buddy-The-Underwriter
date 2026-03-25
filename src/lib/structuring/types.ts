/**
 * Structuring intelligence types.
 * Pure — no DB, no server-only.
 */

export type StructuringRecommendationType =
  | "reduce_loan_amount"
  | "increase_equity"
  | "add_collateral"
  | "improve_valuation_support"
  | "convert_to_exception_path"
  | "defer_until_missing_inputs_resolved"
  | "other";

export type StructuringAction =
  | { kind: "set_loan_amount"; from?: number | null; to: number }
  | { kind: "set_equity_amount"; from?: number | null; to: number }
  | { kind: "set_equity_pct"; from?: number | null; to: number }
  | { kind: "require_additional_collateral"; additional_lendable_value_needed: number; note?: string }
  | { kind: "require_valuation_upgrade"; collateral_id: string; from_method?: string | null; to_method_hint: string }
  | { kind: "proceed_with_exception"; exception_keys: string[]; required_mitigants: string[] }
  | { kind: "resolve_missing_input"; blocker_key: string; field_hint: string };

export type StructuringScenario = {
  id: string;
  label: string;
  recommendation_type: StructuringRecommendationType;
  summary: string;

  projected_loan_amount?: number | null;
  projected_equity_pct?: number | null;
  projected_equity_amount?: number | null;
  projected_gross_collateral_value?: number | null;
  projected_lendable_value?: number | null;
  projected_ltv?: number | null;

  resolves_exception_keys: string[];
  remaining_exception_keys: string[];
  new_exception_keys: string[];

  actions: StructuringAction[];
  tradeoffs: string[];
  assumptions: string[];
  rationale: string;

  recommendation_score: number;
  recommendation_band: "best" | "strong" | "possible" | "exception_only";
  path_type: "inside_policy" | "ready_with_exceptions" | "not_yet_ready";
};

export type PathToApprovalPlan = {
  headline: string;
  path_type: "inside_policy" | "ready_with_exceptions" | "not_yet_ready";
  steps: Array<{
    step_number: number;
    action: string;
    why_it_matters: string;
  }>;
  projected_outcome: string;
  recommendation_summary: string;
};

export type BorrowerOptionSummary = {
  plain_language_summary: string;
  required_changes: string[];
  not_for_external_use_yet: true;
};
