/**
 * SPEC-JOURNEY-RAIL-UNDERWRITING-FLOW-PRIORITY-1 — stage-aware primary-action projection.
 * SPEC-JOURNEY-NEXT-BEST-ACTION-PERFECT-GUIDANCE-1 — always a specific, fixable next-best action.
 *
 * The Journey Rail used to render getNextAction(state) directly, which surfaces the FIRST lifecycle
 * blocker. In underwrite_in_progress computeBlockers emits `risk_pricing_not_finalized` before the
 * later memo / financial / document readiness blockers, so the rail showed "Finalize Pricing" — a
 * downstream committee-readiness gate — as the primary next step while underwriting prerequisites were
 * still incomplete.
 *
 * This pure projection answers "what should the banker do next IN this stage?". For underwrite_in_
 * progress it picks the highest-priority present blocker by banker workflow order (pricing/committee
 * LAST) and renders that blocker's PRECISE fix action (e.g. "Finalize required documents", "Add
 * management profile", "Generate financial snapshot"). The pricing label only surfaces once every
 * earlier prerequisite workstream is clear. When more than one workstream is open the description notes
 * that work remains after this step. "Continue Underwriting" is a true last resort — only when the top
 * blocker has no fix action at all.
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
  missing_business_cash_flow: "financial_computation",
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

/**
 * SPEC-RAIL-STEP-DEDUP-AND-ORDERING-1 — within the financial_computation workstream,
 * blockers have a dependency chain. Upstream must clear before downstream can succeed.
 * Lower index = do first. Codes not listed here sort after all listed codes (stable).
 */
export const INTRA_WORKSTREAM_PRIORITY: Partial<Record<LifecycleBlockerCode, number>> = {
  // financial_computation dependency chain: business → debt service → GCF → DSCR
  missing_business_cash_flow: 0,
  financial_snapshot_missing: 1,
  financial_snapshot_build_failed: 1,
  financial_snapshot_stale_recovery: 1,
  missing_debt_service_facts: 2,
  missing_global_cash_flow: 3,
  missing_dscr: 4,
};

/** Test/consumer helper: the workstream a blocker code belongs to (or null if unmapped). */
export function workstreamForBlocker(code: LifecycleBlockerCode): UnderwritingWorkstream | null {
  return CODE_TO_WORKSTREAM[code] ?? null;
}

function hrefForFix(
  fix: ReturnType<typeof getBlockerFixAction>,
  dealId: string,
): string {
  if (fix && "href" in fix && typeof fix.href === "string" && fix.href.length > 0) return fix.href;
  return `/deals/${dealId}/underwrite`;
}

/**
 * SPEC-JOURNEY-NEXT-BEST-ACTION-PERFECT-GUIDANCE-1 — banker-readable description for the primary CTA.
 *
 * The first sentence is always the top blocker's own message (we never hide what's wrong). When more
 * than one underwriting workstream is open we append a note that work remains after this step, so the
 * banker knows the CTA is the next step, not the last one. Blocker visibility is unchanged.
 */
export function getWorkstreamSummary(
  topWorkstream: UnderwritingWorkstream,
  topBlocker: LifecycleBlocker,
  multipleWorkstreams: boolean,
): string {
  const base = (topBlocker.message ?? "").trim() || "Continue the next underwriting step.";
  if (!multipleWorkstreams) return base;
  const sep = /[.!?]$/.test(base) ? " " : ". ";
  return `${base}${sep}Other underwriting items remain open after this step.`;
}

/**
 * The stage-aware primary action for the Journey Rail. Non-underwriting stages defer to getNextAction.
 */
export function buildJourneyPrimaryAction(state: LifecycleState, dealId: string): NextAction {
  if (state.stage !== "underwrite_in_progress") {
    return getNextAction(state, dealId);
  }

  // Highest-priority blocker per workstream. SPEC-RAIL-STEP-DEDUP-AND-ORDERING-1: within a
  // workstream, prefer the upstream dependency (lower INTRA_WORKSTREAM_PRIORITY) as the CTA so
  // the banker is sent to e.g. financial analysis (business cash flow) before the GCF page that
  // can't compute yet. Codes with no explicit priority keep first-seen (lifecycle) order.
  const firstByWorkstream = new Map<UnderwritingWorkstream, LifecycleBlocker>();
  for (const b of state.blockers) {
    const ws = CODE_TO_WORKSTREAM[b.code];
    if (!ws) continue;
    const existing = firstByWorkstream.get(ws);
    if (!existing) {
      firstByWorkstream.set(ws, b);
    } else {
      const existingPri = INTRA_WORKSTREAM_PRIORITY[existing.code] ?? Number.MAX_SAFE_INTEGER;
      const newPri = INTRA_WORKSTREAM_PRIORITY[b.code] ?? Number.MAX_SAFE_INTEGER;
      if (newPri < existingPri) firstByWorkstream.set(ws, b);
    }
  }

  // No recognized underwriting workstream blockers → keep the existing stage action
  // ("Complete Underwriting"), which also covers the fully-unblocked case.
  if (firstByWorkstream.size === 0) {
    return getNextAction(state, dealId);
  }

  const topWorkstream = UNDERWRITING_WORKSTREAM_ORDER.find((ws) => firstByWorkstream.has(ws))!;
  const topBlocker = firstByWorkstream.get(topWorkstream)!;
  const multipleWorkstreams = firstByWorkstream.size > 1;
  const description = getWorkstreamSummary(topWorkstream, topBlocker, multipleWorkstreams);

  // Always derive the CTA from the highest-priority blocker's precise fix action so the rail tells the
  // banker exactly what to do — e.g. "Finalize required documents", "Add management profile",
  // "Generate financial snapshot". Because risk_pricing/committee are LAST in the workstream order, the
  // pricing label only surfaces once every earlier prerequisite workstream is clear. "Continue
  // Underwriting" is a true last resort — only when the top blocker has no fix action at all.
  const fix = getBlockerFixAction(topBlocker, dealId);
  return {
    label: fix?.label ?? "Continue Underwriting",
    href: hrefForFix(fix, dealId),
    intent: "navigate",
    description,
  };
}
