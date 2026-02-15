/**
 * Buddy Lifecycle Model
 *
 * Unified lifecycle types that derive from both DealStage (borrower-facing)
 * and DealLifecycleStage (internal) models, plus deal_events ledger.
 *
 * This module provides a single source of truth for "where is this deal?"
 * with explicit blockers and evidence for why it can't advance.
 */

/**
 * Unified lifecycle stages - maps from both existing models.
 *
 * Mapping from existing infrastructure:
 * - intake_created: deals.stage = "created"
 * - docs_requested: deals.stage = "intake" + checklist seeded
 * - docs_in_progress: deals.stage = "collecting" + checklist incomplete
 * - docs_satisfied: deals.stage = "collecting" + checklist complete
 * - underwrite_ready: docs_satisfied + submitted loan request + pricing assumptions exist
 * - underwrite_in_progress: deals.stage = "underwriting"
 * - committee_ready: underwrite complete + committee packet exists
 * - committee_decisioned: decision_snapshots.status = "final"
 * - closing_in_progress: deal_status.stage = "closing"
 * - closed: deal_status.stage = "funded"
 * - workout: special branch for troubled assets
 */
export type LifecycleStage =
  | "intake_created"
  | "docs_requested"
  | "docs_in_progress"
  | "docs_satisfied"
  | "underwrite_ready"
  | "underwrite_in_progress"
  | "committee_ready"
  | "committee_decisioned"
  | "closing_in_progress"
  | "closed"
  | "workout";

/**
 * Blocker codes - specific reasons why lifecycle cannot advance.
 * Each code maps to actionable remediation.
 */
export type LifecycleBlockerCode =
  // Business logic blockers
  | "identity_not_verified"
  | "financial_snapshot_missing"
  | "underwrite_not_started"
  | "underwrite_incomplete"
  | "policy_exceptions_unresolved"
  | "committee_packet_missing"
  | "decision_missing"
  | "attestation_missing"
  | "closing_docs_missing"
  | "pricing_quote_missing"
  | "risk_pricing_not_finalized"
  | "deal_not_found"
  | "checklist_not_seeded"
  | "loan_request_missing"
  | "loan_request_incomplete"
  | "spreads_incomplete"
  | "pricing_assumptions_required"
  | "structural_pricing_missing"
  | "gatekeeper_docs_need_review"
  | "gatekeeper_docs_incomplete"
  // Runtime/infrastructure blockers - specific per data source
  | "checklist_fetch_failed"
  | "snapshot_fetch_failed"
  | "decision_fetch_failed"
  | "attestation_fetch_failed"
  | "packet_fetch_failed"
  | "advancement_fetch_failed"
  | "readiness_fetch_failed"
  // Schema / infrastructure errors
  | "schema_mismatch"
  // Generic fallbacks (use specific codes above when possible)
  | "data_fetch_failed"
  | "internal_error";

/**
 * A blocker with human-readable message and optional evidence.
 */
export type LifecycleBlocker = {
  code: LifecycleBlockerCode;
  message: string;
  evidence?: Record<string, unknown>;
};

/**
 * Derived facts about the deal's current state.
 * All computed from canonical data sources - never manually set.
 *
 * Document readiness is driven exclusively by the gatekeeper AI engine.
 */
export type LifecycleDerived = {
  /** True if all required documents are present (gatekeeper-authoritative) */
  documentsReady: boolean;
  /** Document readiness percentage 0-100 (gatekeeper-authoritative) */
  documentsReadinessPct: number;
  /** True if underwrite has been started */
  underwriteStarted: boolean;
  /** True if financial snapshot exists */
  financialSnapshotExists: boolean;
  /** True if committee packet has been generated */
  committeePacketReady: boolean;
  /** True if a final decision exists */
  decisionPresent: boolean;
  /** True if committee is required for this deal */
  committeeRequired: boolean;
  /** True if a locked pricing quote exists */
  pricingQuoteReady: boolean;
  /** True if risk pricing has been finalized */
  riskPricingFinalized: boolean;
  /** True if attestation requirements are satisfied */
  attestationSatisfied: boolean;
  /** True if all document artifacts have been processed (no queued/processing/failed) */
  aiPipelineComplete: boolean;
  /** True if all spread jobs have completed (no QUEUED/RUNNING/FAILED jobs) */
  spreadsComplete: boolean;
  /** True if structural pricing has been computed from loan request */
  structuralPricingReady: boolean;
  /** True if deal_pricing_inputs row exists for this deal */
  hasPricingAssumptions: boolean;
  /** True if at least one loan request is non-draft with a requested_amount */
  hasSubmittedLoanRequest: boolean;
  /** True if all research missions have completed (no queued/running missions) */
  researchComplete: boolean;
  /** Request correlation ID for debugging (optional, set by route) */
  correlationId?: string;
  // Gatekeeper-derived readiness detail fields
  /** True if all AI-verifiable required docs are present and no NEEDS_REVIEW */
  gatekeeperDocsReady?: boolean;
  /** AI document readiness percentage (PFS excluded since AI can't classify it) */
  gatekeeperReadinessPct?: number;
  /** Count of documents flagged as NEEDS_REVIEW by gatekeeper */
  gatekeeperNeedsReviewCount?: number;
  /** Missing business tax return years */
  gatekeeperMissingBtrYears?: number[];
  /** Missing personal tax return years */
  gatekeeperMissingPtrYears?: number[];
  /** Whether financial statements are missing */
  gatekeeperMissingFinancialStatements?: boolean;
};

/**
 * Complete lifecycle state for a deal.
 * The single source of truth for "where is this deal and what's blocking it?"
 */
export type LifecycleState = {
  /** Current unified lifecycle stage */
  stage: LifecycleStage;
  /** ISO timestamp of last stage advancement, null if never advanced */
  lastAdvancedAt: string | null;
  /** List of blockers preventing advancement (empty if can advance) */
  blockers: LifecycleBlocker[];
  /** Derived facts computed from canonical sources */
  derived: LifecycleDerived;
};

/**
 * Actor context for lifecycle events.
 */
export type ActorContext = {
  type: "system" | "banker" | "borrower" | "builder" | "automation";
  id: string;
  correlationId?: string;
};

/**
 * Result of attempting to advance lifecycle.
 */
export type AdvanceLifecycleResult =
  | { ok: true; advanced: true; state: LifecycleState }
  | { ok: true; advanced: false; state: LifecycleState; reason: string }
  | { ok: false; error: "blocked"; blockers: LifecycleBlocker[]; allBlockers?: LifecycleBlocker[]; state: LifecycleState }
  | { ok: false; error: "deal_not_found" };

/**
 * Allowed stage transitions (linear progression + workout branch).
 */
export const ALLOWED_STAGE_TRANSITIONS: Record<LifecycleStage, LifecycleStage[]> = {
  intake_created: ["docs_requested"],
  docs_requested: ["docs_in_progress"],
  docs_in_progress: ["docs_satisfied"],
  docs_satisfied: ["underwrite_ready"],
  underwrite_ready: ["underwrite_in_progress"],
  underwrite_in_progress: ["committee_ready"],
  committee_ready: ["committee_decisioned"],
  committee_decisioned: ["closing_in_progress", "workout"],
  closing_in_progress: ["closed"],
  closed: [], // Terminal
  workout: [], // Branch terminal (can have sub-states later)
};

/**
 * Human-readable labels for each stage.
 */
export const STAGE_LABELS: Record<LifecycleStage, string> = {
  intake_created: "Deal Created",
  docs_requested: "Documents Requested",
  docs_in_progress: "Collecting Documents",
  docs_satisfied: "Documents Complete",
  underwrite_ready: "Ready for Underwriting",
  underwrite_in_progress: "Underwriting",
  committee_ready: "Ready for Committee",
  committee_decisioned: "Decision Made",
  closing_in_progress: "Closing",
  closed: "Closed",
  workout: "Workout",
};
