/**
 * SPEC-JOURNEY-RAIL-UNDERWRITING-FLOW-PRIORITY-1 — stage-aware primary-action projection.
 *
 * The Journey Rail used to render getNextAction(state) directly, which surfaces the FIRST lifecycle
 * blocker. In underwrite_in_progress computeBlockers emits `risk_pricing_not_finalized` before the
 * later memo / financial / document readiness blockers, so the rail showed "Finalize Pricing" — a
 * downstream committee-readiness gate — as the primary next step while underwriting prerequisites were
 * still incomplete.
 *
 * This pure projection answers "what should the banker do next IN this stage?". For underwrite_in_
 * progress it reorders the present blockers by banker workflow priority and:
 *   - shows a SPECIFIC action only when a single workstream remains (e.g. "Finalize Pricing" once every
 *     earlier prerequisite is complete);
 *   - shows a neutral "Continue Underwriting" (with subtext naming the most important blocker) when
 *     multiple prerequisite workstreams are still incomplete.
 *
 * For every other stage it defers to getNextAction unchanged. It never advances the lifecycle, never
 * changes pricing/financial math, and never hides blockers — it only reorders the primary CTA. Pure:
 * no IO, no DB.
 */

import type { LifecycleBlocker, LifecycleBlockerCode, LifecycleState } from "@/buddy/lifecycle/model";
import { getNextAction, getBlockerFixAction, type NextAction } from "@/buddy/lifecycle/nextAction";

/**
 * Banker-flow workstreams for underwrite_in_progress, highest priority first. The pricing/committee
 * buckets are intentionally LAST so a finalization gate never masquerades as the next human step while
 * earlier underwriting work is open.
 */
export type UnderwritingWorkstream =
  | "loan_request"          // a genuinely missing/incomplete loan request still comes first
  | "documents"             // a. document / intake reconciliation
  | "financial_computation" // b. spread / financial computation readiness
  | "spread_evidence"       // c. source-evidence / spread review
  | "memo_inputs"           // d. memo input completeness
  | "financial_validation"  // e. financial validation
  | "risk_pricing"          // f. risk pricing finalization (LATE gate)
  | "committee";            // g. committee packet / decision readiness (LATE gate)

export const UNDERWRITING_WORKSTREAM_ORDER: UnderwritingWorkstream[] = [
  "loan_request",
  "documents",
  "financial_computation",
  "spread_evidence",
  "memo_inputs",
  "financial_validation",
  "risk_pricing",
  "committee",
];

/**
 * Prerequisite workstreams — everything that must be in hand BEFORE pricing finalization is the right
 * human next step. While any of these is the top remaining workstream we never present "Finalize
 * Pricing" as the primary CTA.
 */
const PREREQUISITE_WORKSTREAMS = new Set<UnderwritingWorkstream>([
  "loan_request",
  "documents",
  "financial_computation",
  "spread_evidence",
  "memo_inputs",
  "financial_validation",
]);

/** Map each lifecycle blocker code to its banker workstream. Unmapped codes are ignored here and the
 *  projection falls back to getNextAction (preserves existing behavior for infra/error blockers). */
const CODE_TO_WORKSTREAM: Partial<Record<LifecycleBlockerCode, UnderwritingWorkstream>> = {
  // loan request (still top priority if genuinely missing/incomplete)
  loan_request_missing: "loan_request",
  loan_request_incomplete: "loan_request",

  // a. document / intake reconciliation
  borrower_not_attached: "documents",
  identity_not_verified: "documents",
  gatekeeper_docs_need_review: "documents",
  gatekeeper_docs_incomplete: "documents",
  unfinalized_required_documents: "documents",
  financial_period_review_open: "documents",
  intake_confirmation_required: "documents",
  intake_health_below_threshold: "documents",
  documents_processing_stalled: "documents",
  artifacts_processing_stalled: "documents",

  // b. spread / financial computation readiness
  financial_snapshot_missing: "financial_computation",
  missing_dscr: "financial_computation",
  missing_debt_service_facts: "financial_computation",
  missing_global_cash_flow: "financial_computation",
  financial_snapshot_stale_recovery: "financial_computation",
  financial_snapshot_build_failed: "financial_computation",

  // c. source-evidence / spread review
  spreads_incomplete: "spread_evidence",

  // d. memo input completeness
  missing_business_description: "memo_inputs",
  missing_revenue_model: "memo_inputs",
  missing_management_profile: "memo_inputs",
  missing_collateral_item: "memo_inputs",
  missing_collateral_value: "memo_inputs",
  missing_research_quality_gate: "memo_inputs",
  open_fact_conflicts: "memo_inputs",
  missing_policy_exception_review: "memo_inputs",
  policy_exceptions_unresolved: "memo_inputs",
  collateral_extraction_needed: "memo_inputs",
  memo_prefill_stale: "memo_inputs",
  research_stalled: "memo_inputs",

  // e. financial validation (critical risk flags are a validation gate before committee)
  financial_validation_open: "financial_validation",
  financial_snapshot_stale: "financial_validation",
  critical_flags_unresolved: "financial_validation",

  // f. risk pricing finalization (LATE)
  risk_pricing_not_finalized: "risk_pricing",
  structural_pricing_missing: "risk_pricing",
  pricing_quote_missing: "risk_pricing",
  pricing_assumptions_required: "risk_pricing",

  // g. committee packet / decision readiness (LATE)
  committee_packet_missing: "committee",
  decision_missing: "committee",
  attestation_missing: "committee",
};

/** Test/consumer helper: the workstream a blocker code belongs to (or null if unmapped). */
export function workstreamForBlocker(code: LifecycleBlockerCode): UnderwritingWorkstream | null {
  return CODE_TO_WORKSTREAM[code] ?? null;
}

function hrefForBlocker(blocker: LifecycleBlocker, dealId: string): string {
  const fix = getBlockerFixAction(blocker, dealId);
  if (fix && "href" in fix && typeof fix.href === "string" && fix.href.length > 0) return fix.href;
  return `/deals/${dealId}/underwrite`;
}

/**
 * The stage-aware primary action for the Journey Rail. Non-underwriting stages defer to getNextAction.
 */
export function buildJourneyPrimaryAction(state: LifecycleState, dealId: string): NextAction {
  if (state.stage !== "underwrite_in_progress") {
    return getNextAction(state, dealId);
  }

  // First blocker seen (in lifecycle order) per workstream — preserves a meaningful message/href.
  const firstByWorkstream = new Map<UnderwritingWorkstream, LifecycleBlocker>();
  for (const b of state.blockers) {
    const ws = CODE_TO_WORKSTREAM[b.code];
    if (ws && !firstByWorkstream.has(ws)) firstByWorkstream.set(ws, b);
  }

  // No recognized underwriting workstream blockers → keep the existing stage action
  // ("Complete Underwriting"), which also covers the fully-unblocked case.
  if (firstByWorkstream.size === 0) {
    return getNextAction(state, dealId);
  }

  const topWorkstream = UNDERWRITING_WORKSTREAM_ORDER.find((ws) => firstByWorkstream.has(ws))!;
  const topBlocker = firstByWorkstream.get(topWorkstream)!;
  const href = hrefForBlocker(topBlocker, dealId);
  const multipleWorkstreams = firstByWorkstream.size > 1;

  // While a prerequisite workstream is the top remaining work AND more than one workstream is open,
  // present a neutral in-progress CTA naming the most important blocker — not a finalization gate.
  if (PREREQUISITE_WORKSTREAMS.has(topWorkstream) && multipleWorkstreams) {
    return {
      label: "Continue Underwriting",
      href,
      intent: "navigate",
      description: topBlocker.message,
    };
  }

  // Otherwise show the specific action for the top workstream. When the top (and only relevant)
  // workstream is risk_pricing, this is precisely "Finalize Pricing" — earlier prerequisites are done.
  const fix = getBlockerFixAction(topBlocker, dealId);
  return {
    label: fix?.label ?? "Continue Underwriting",
    href,
    intent: "navigate",
    description: topBlocker.message,
  };
}
