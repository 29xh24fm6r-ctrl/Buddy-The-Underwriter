/**
 * Assemble a canonical credit decision package from frozen state.
 * Pure module — no DB, no server-only.
 */

export type CreditDecisionPackageStatus =
  | "draft"
  | "ready_for_committee"
  | "decision_recorded"
  | "finalized";

export type CreditDecisionPackage = {
  deal_id: string;
  freeze_id: string;
  structuring_selection_id: string;
  memo_snapshot_id: string;
  committee_decision_id?: string | null;

  approved_structure_json: Record<string, unknown>;
  approved_exceptions_json: unknown[];
  approved_mitigants_json: string[];
  memo_json: Record<string, unknown>;

  package_status: CreditDecisionPackageStatus;
};

export type DecisionPackageInput = {
  deal_id: string;
  freeze_id: string;
  selection_id: string;
  memo_snapshot_id: string;
  committee_decision_id?: string | null;

  frozen_builder_state: Record<string, unknown>;
  frozen_exceptions: unknown[];
  frozen_mitigants: string[];
  memo_output: Record<string, unknown>;

  has_committee_decision: boolean;
  is_finalized: boolean;
};

export function buildCreditDecisionPackage(
  input: DecisionPackageInput,
): CreditDecisionPackage {
  let status: CreditDecisionPackageStatus = "draft";
  if (input.is_finalized) {
    status = "finalized";
  } else if (input.has_committee_decision) {
    status = "decision_recorded";
  } else if (input.memo_snapshot_id) {
    status = "ready_for_committee";
  }

  return {
    deal_id: input.deal_id,
    freeze_id: input.freeze_id,
    structuring_selection_id: input.selection_id,
    memo_snapshot_id: input.memo_snapshot_id,
    committee_decision_id: input.committee_decision_id,

    approved_structure_json: input.frozen_builder_state,
    approved_exceptions_json: input.frozen_exceptions,
    approved_mitigants_json: input.frozen_mitigants,
    memo_json: input.memo_output,

    package_status: status,
  };
}
