/**
 * Compute Blockers — Pure Function
 *
 * Determines lifecycle blockers based on current stage and derived state.
 * No DB, no IO, no server-only — fully testable.
 *
 * @internal — exported for testing
 */

import type {
  LifecycleStage,
  LifecycleBlocker,
  LifecycleDerived,
} from "./model";
import { stageRequiresDocuments } from "./stages";

export function computeBlockers(
  stage: LifecycleStage,
  derived: LifecycleDerived,
  checklistCount: number,
  loanRequestCount: number = 0,
  loanRequestHasIncomplete: boolean = false,
): LifecycleBlocker[] {
  const blockers: LifecycleBlocker[] = [];

  // Early stages: checklist not seeded
  if (stage === "intake_created" && checklistCount === 0) {
    blockers.push({
      code: "checklist_not_seeded",
      message: "Checklist has not been created for this deal",
    });
  }

  // Loan request blockers — check from docs_requested onward (not intake_created)
  if (
    stage !== "intake_created" &&
    stage !== "closed" &&
    stage !== "workout" &&
    loanRequestCount === 0
  ) {
    blockers.push({
      code: "loan_request_missing",
      message: "No loan request has been created for this deal",
    });
  }

  if (
    loanRequestCount > 0 &&
    loanRequestHasIncomplete &&
    ["docs_satisfied", "underwrite_ready", "underwrite_in_progress"].includes(stage)
  ) {
    blockers.push({
      code: "loan_request_incomplete",
      message: "One or more loan requests are incomplete (missing amount or still in draft)",
    });
  }

  // Spread pipeline completeness — informational only, NOT a lifecycle blocker.
  // Spreads run in parallel and should never gate pricing or advancement.
  // The derived.spreadsComplete flag is still visible in ReadinessPanel dots.

  // Gatekeeper content-based readiness blockers (sole authority for document readiness)
  if (
    stageRequiresDocuments(stage) &&
    derived.gatekeeperMissingBtrYears !== undefined
  ) {
    // gatekeeper_docs_need_review — highest priority (pushed first)
    if ((derived.gatekeeperNeedsReviewCount ?? 0) > 0) {
      blockers.push({
        code: "gatekeeper_docs_need_review",
        message: `${derived.gatekeeperNeedsReviewCount} document(s) flagged for review by AI`,
        evidence: { needsReviewCount: derived.gatekeeperNeedsReviewCount },
      });
    }

    // gatekeeper_docs_incomplete
    if (derived.gatekeeperReadinessPct != null && derived.gatekeeperReadinessPct < 100) {
      blockers.push({
        code: "gatekeeper_docs_incomplete",
        message: `AI document readiness at ${Math.round(derived.gatekeeperReadinessPct)}% — missing required documents`,
        evidence: {
          readinessPct: derived.gatekeeperReadinessPct,
          ...(derived.gatekeeperMissingBtrYears?.length && { missingBusinessTaxYears: derived.gatekeeperMissingBtrYears }),
          ...(derived.gatekeeperMissingPtrYears?.length && { missingPersonalTaxYears: derived.gatekeeperMissingPtrYears }),
          ...(derived.gatekeeperMissingFinancialStatements && { missingFinancialStatements: true }),
        },
      });
    }
  }

  // Pricing assumptions blocker — needed to advance from docs_satisfied to underwrite_ready
  if (stage === "docs_satisfied" && !derived.hasPricingAssumptions) {
    blockers.push({
      code: "pricing_assumptions_required",
      message: "Pricing assumptions must be configured before underwriting",
    });
  }

  // Financial snapshot blocker — fires in underwrite_ready stage
  // (snapshot is generated IN the underwrite flow, not as a prerequisite TO it)
  if (stage === "underwrite_ready" && !derived.financialSnapshotExists) {
    blockers.push({
      code: "financial_snapshot_missing",
      message: "Financial snapshot must be generated to begin underwriting",
    });
  }

  // Risk pricing finalization blocker — must be reviewed and finalized before committee
  if (
    stage === "underwrite_in_progress" &&
    !derived.riskPricingFinalized
  ) {
    blockers.push({
      code: "risk_pricing_not_finalized",
      message: "Risk pricing must be reviewed and finalized before advancing to committee",
    });
  }

  // Structural pricing blocker — auto-created from loan request submission
  if (
    stage === "underwrite_in_progress" &&
    !derived.structuralPricingReady
  ) {
    blockers.push({
      code: "structural_pricing_missing",
      message: "Structural pricing has not been computed (save pricing assumptions or submit a loan request)",
    });
  }

  // Pricing quote blocker — a locked quote/decision is required before committee
  if (
    stage === "committee_ready" &&
    !derived.pricingQuoteReady
  ) {
    blockers.push({
      code: "pricing_quote_missing",
      message: "A locked pricing quote is required before committee review",
    });
  }

  // Committee readiness blockers
  if (stage === "underwrite_in_progress" || stage === "committee_ready") {
    if (!derived.committeePacketReady && derived.committeeRequired) {
      blockers.push({
        code: "committee_packet_missing",
        message: "Committee packet must be generated before decision",
      });
    }
  }

  // Decision blockers
  if (stage === "committee_ready" && !derived.decisionPresent) {
    blockers.push({
      code: "decision_missing",
      message: "Final decision has not been recorded",
    });
  }

  // Attestation blockers (only if decision exists but not attested)
  if (stage === "committee_decisioned" && !derived.attestationSatisfied) {
    blockers.push({
      code: "attestation_missing",
      message: "Required attestations not yet completed",
    });
  }

  return blockers;
}
