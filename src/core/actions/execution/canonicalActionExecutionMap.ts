/**
 * Phase 65E — Canonical Action → Execution Map
 *
 * Every BuddyActionCode maps to an execution mode and target system.
 * Exhaustive — adding a new action code without a mapping is a type error.
 */

import type { BuddyActionCode } from "@/core/actions/types";
import type { CanonicalExecutionTarget } from "./types";

export type CanonicalExecutionMode =
  | "direct_write"
  | "queue_job"
  | "task_only"
  | "noop";

export type CanonicalExecutionMapping = {
  mode: CanonicalExecutionMode;
  target: CanonicalExecutionTarget;
};

export const CANONICAL_ACTION_EXECUTION_MAP: Record<
  BuddyActionCode,
  CanonicalExecutionMapping
> = {
  seed_checklist:                  { mode: "direct_write", target: "workflow" },
  request_documents:               { mode: "direct_write", target: "conditions" },
  review_uploaded_documents:       { mode: "task_only",    target: "workflow" },
  finalize_document_classification:{ mode: "task_only",    target: "workflow" },
  resolve_readiness_blockers:      { mode: "task_only",    target: "workflow" },
  set_pricing_assumptions:         { mode: "task_only",    target: "pricing" },
  run_extraction:                  { mode: "queue_job",    target: "workflow" },
  review_extracted_data:           { mode: "task_only",    target: "workflow" },
  generate_financial_snapshot:     { mode: "queue_job",    target: "financial_snapshot" },
  finalize_risk_pricing:           { mode: "task_only",    target: "pricing" },
  complete_structural_pricing:     { mode: "task_only",    target: "pricing" },
  commit_pricing_quote:            { mode: "task_only",    target: "pricing" },
  generate_committee_packet:       { mode: "task_only",    target: "committee" },
  resolve_critical_flags:          { mode: "task_only",    target: "committee" },
  record_committee_decision:       { mode: "task_only",    target: "committee" },
  complete_attestation:            { mode: "task_only",    target: "workflow" },
  submit_loan_request:             { mode: "task_only",    target: "workflow" },
  start_underwriting:              { mode: "task_only",    target: "workflow" },
  review_credit_memo:              { mode: "task_only",    target: "memo" },
  start_closing:                   { mode: "task_only",    target: "closing" },
  complete_closing:                { mode: "task_only",    target: "closing" },
  no_action_required:              { mode: "noop",         target: "workflow" },
};
