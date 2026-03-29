// Pure function. No DB. No side effects. No network.
import type {
  PriorityDerivationInput,
  RelationshipSurfacePriorityBucket,
} from "./types";
import { lookupReason, REASON_CATALOG } from "./relationshipSurfaceReasonCatalog";

export interface PriorityResult {
  priorityBucket: RelationshipSurfacePriorityBucket;
  priorityScore: number;
  primaryReasonCode: string;
  primaryActionCode: string | null;
}

/**
 * Deterministic priority arbitration across all 65K layers.
 * Returns exactly one primary reason and one primary action.
 *
 * Priority tiers (lower = more urgent):
 * T1 (100s): Integrity — data/truth issues
 * T2 (200s): Critical distress — monitoring, crypto liquidation, protection
 * T3 (300s): Time-bound review — renewal, annual review, deadlines
 * T4 (400s): Borrower-blocked — overdue items, treasury stall, cure pending
 * T5 (500s): Protection work — runoff, deterioration, fragility
 * T6 (600s): Growth work — profitability, expansion, pricing
 * T7 (700s): Informational — healthy monitoring
 */
export function deriveRelationshipSurfacePriority(
  input: PriorityDerivationInput,
): PriorityResult {
  // Build candidate list sorted by precedence
  const candidates: Array<{ code: string; precedence: number }> = [];

  for (const code of input.reasonCodes) {
    const entry = lookupReason(code);
    if (entry) {
      candidates.push({ code: entry.code, precedence: entry.precedence });
    }
  }

  // Add signal-derived reasons if applicable
  if (input.hasIntegrityIssue && !candidates.some((c) => c.precedence < 200)) {
    candidates.push({ code: "data_integrity_issue", precedence: 100 });
  }
  if (input.hasCryptoLiquidationReview && !candidates.some((c) => c.code === "crypto_liquidation_review_required")) {
    candidates.push({ code: "crypto_liquidation_review_required", precedence: 202 });
  }
  if (input.hasCriticalProtection && !candidates.some((c) => c.code === "critical_protection_case")) {
    candidates.push({ code: "critical_protection_case", precedence: 203 });
  }
  if (input.hasCureExpired && !candidates.some((c) => c.code === "cure_expired_critical")) {
    candidates.push({ code: "cure_expired_critical", precedence: 204 });
  }
  if (input.hasRenewalOverdue && !candidates.some((c) => c.code === "renewal_overdue")) {
    candidates.push({ code: "renewal_overdue", precedence: 300 });
  }
  if (input.hasAnnualReviewOverdue && !candidates.some((c) => c.code === "annual_review_overdue")) {
    candidates.push({ code: "annual_review_overdue", precedence: 301 });
  }
  if (input.hasBorrowerOverdue && !candidates.some((c) => c.code === "borrower_items_overdue")) {
    candidates.push({ code: "borrower_items_overdue", precedence: 400 });
  }
  if (input.hasMarginCurePending && !candidates.some((c) => c.code === "crypto_margin_cure_pending")) {
    candidates.push({ code: "crypto_margin_cure_pending", precedence: 402 });
  }
  if (input.hasProtectionWork && !candidates.some((c) => c.precedence >= 500 && c.precedence < 600)) {
    candidates.push({ code: "runoff_risk_high", precedence: 500 });
  }
  if (input.hasGrowthWork && !candidates.some((c) => c.precedence >= 600 && c.precedence < 700)) {
    candidates.push({ code: "profitability_review", precedence: 600 });
  }

  // If no candidates, default to healthy monitoring
  if (candidates.length === 0) {
    candidates.push({ code: "healthy_monitoring", precedence: 700 });
  }

  // Sort by precedence ascending (most urgent first) — stable sort
  candidates.sort((a, b) => a.precedence - b.precedence);

  // Hard rule: no informational winner when any actionable blocker exists
  const hasActionableBlocker = input.blockerCount > 0 || candidates.some((c) => c.precedence < 700);
  const winner = hasActionableBlocker
    ? candidates.find((c) => c.precedence < 700) ?? candidates[0]
    : candidates[0];

  const winnerEntry = lookupReason(winner.code);

  // Derive bucket from precedence
  const priorityBucket = deriveBucket(winner.precedence);

  // Derive action from the winning reason's default actionability
  const primaryActionCode = deriveActionCode(winner.code);

  return {
    priorityBucket,
    priorityScore: 1000 - winner.precedence, // Higher score = more urgent
    primaryReasonCode: winner.code,
    primaryActionCode,
  };
}

function deriveBucket(precedence: number): RelationshipSurfacePriorityBucket {
  if (precedence < 300) return "critical";
  if (precedence < 500) return "urgent";
  if (precedence < 700) return "watch";
  return "healthy";
}

function deriveActionCode(reasonCode: string): string | null {
  const actionMap: Record<string, string | null> = {
    data_integrity_issue: "review_relationship_health",
    recomputation_invalid: "review_relationship_health",
    source_evidence_unavailable: "review_relationship_health",
    critical_monitoring_exception: "resolve_monitoring_exception",
    critical_renewal_failure: "start_renewal_process",
    crypto_liquidation_review_required: "approve_liquidation",
    critical_protection_case: "resolve_crypto_distress",
    cure_expired_critical: "advance_crypto_cure",
    renewal_overdue: "start_renewal_process",
    annual_review_overdue: "complete_annual_review",
    banker_deadline_review: "review_relationship_health",
    protection_renewal_window: "review_relationship_health",
    borrower_items_overdue: "collect_borrower_documents",
    treasury_onboarding_stalled: "collect_borrower_documents",
    crypto_margin_cure_pending: "advance_crypto_cure",
    borrower_reengagement_required: "collect_borrower_documents",
    runoff_risk_high: "review_relationship_health",
    deterioration_accelerating: "review_relationship_health",
    shallow_renewal_fragility: "review_relationship_health",
    treasury_stall_retention: "review_relationship_health",
    crypto_warning_open: "review_crypto_collateral",
    crypto_custody_unverified: "verify_custody_control",
    crypto_valuation_unavailable: "refresh_crypto_valuation",
    crypto_margin_call_open: "open_margin_call",
    crypto_monitoring_stalled: "review_crypto_collateral",
    profitability_review: "review_relationship_health",
    expansion_review: "review_relationship_health",
    pricing_context_review: "review_relationship_health",
    renewal_bundle_opportunity: "review_relationship_health",
    healthy_monitoring: null,
    no_active_deals: null,
    deposit_status_unknown: null,
  };
  return actionMap[reasonCode] ?? null;
}
