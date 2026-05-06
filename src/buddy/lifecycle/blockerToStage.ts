import type { LifecycleBlockerCode, LifecycleStage } from "./model";

/**
 * Maps a lifecycle blocker code to the stage it gates.
 * Returns null for infrastructure/runtime errors that are not stage-specific
 * (those should render as a rail-level banner).
 */
export function blockerGatesStage(code: LifecycleBlockerCode): LifecycleStage | null {
  switch (code) {
    // === Intake / docs_requested ===
    case "checklist_not_seeded":
    case "borrower_not_attached":
    case "loan_request_missing":
    case "loan_request_incomplete":
    case "identity_not_verified":
      return "docs_requested";

    // === docs_in_progress ===
    case "intake_health_below_threshold":
    case "intake_confirmation_required":
      return "docs_in_progress";

    // === docs_satisfied ===
    case "gatekeeper_docs_incomplete":
    case "gatekeeper_docs_need_review":
    case "artifacts_processing_stalled":
      return "docs_satisfied";

    // === underwrite_ready ===
    case "pricing_assumptions_required":
    case "structural_pricing_missing":
    case "spreads_incomplete":
    case "financial_snapshot_missing":
    case "financial_snapshot_stale":
    case "financial_snapshot_build_failed":
    case "financial_validation_open":
      return "underwrite_ready";

    // === underwrite_in_progress ===
    case "underwrite_not_started":
    case "underwrite_incomplete":
    case "critical_flags_unresolved":
      return "underwrite_in_progress";

    // === committee_ready ===
    case "committee_packet_missing":
      return "committee_ready";

    // === committee_decisioned ===
    case "decision_missing":
    case "policy_exceptions_unresolved":
      return "committee_decisioned";

    // === closing_in_progress ===
    case "attestation_missing":
    case "closing_docs_missing":
    case "pricing_quote_missing":
    case "risk_pricing_not_finalized":
      return "closing_in_progress";

    // === Infrastructure / fetch / fatal — render as rail-level banner ===
    case "deal_not_found":
    case "schema_mismatch":
    case "internal_error":
    case "data_fetch_failed":
    case "checklist_fetch_failed":
    case "snapshot_fetch_failed":
    case "decision_fetch_failed":
    case "attestation_fetch_failed":
    case "packet_fetch_failed":
    case "advancement_fetch_failed":
    case "readiness_fetch_failed":
      return null;

    default: {
      // Exhaustiveness guard — if a new blocker code is added without mapping,
      // TypeScript will flag this branch.
      const _exhaustive: never = code;
      void _exhaustive;
      return null;
    }
  }
}
