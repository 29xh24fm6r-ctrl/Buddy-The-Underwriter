// Pure evaluator for the Memo Input Completeness Layer.
//
// PURITY NOTE: This file MUST NOT import "server-only" or any module that
// transitively imports it. It is consumed both by the submission pipeline
// (server-only) AND by CI guard tests under node:test. A regression that
// pulls in supabaseAdmin or writeEvent here will silently break CI.
//
// Contract (mirrors the table-level invariant):
//   No banker-submitted memo unless Buddy can prove:
//     1. required borrower story exists
//     2. required financial facts exist
//     3. required collateral facts exist
//     4. required management facts exist
//     5. required research exists
//     6. conflicting facts are resolved or acknowledged

import type {
  EvaluateMemoInputReadinessArgs,
  MemoInputBlocker,
  MemoInputBlockerCode,
  MemoInputReadiness,
  MemoInputWarning,
} from "./types";

const BUSINESS_DESCRIPTION_MIN = 20;
const REVENUE_MODEL_MIN = 10;
const READINESS_FLOOR = 0;
const READINESS_CEILING = 100;

// Each blocker code carries a fixed weight for readiness scoring. Total
// possible deductions sum to 100 — every blocker codes a proportionate
// hit so the score is interpretable.
const BLOCKER_WEIGHTS: Record<MemoInputBlockerCode, number> = {
  missing_business_description: 12,
  missing_revenue_model: 6,
  missing_management_profile: 12,
  missing_collateral_item: 10,
  missing_collateral_value: 10,
  missing_dscr: 12,
  missing_debt_service_facts: 10,
  missing_global_cash_flow: 8,
  missing_research_quality_gate: 8,
  open_fact_conflicts: 6,
  unfinalized_required_documents: 4,
  missing_policy_exception_review: 2,
};

export function evaluateMemoInputReadiness(
  args: EvaluateMemoInputReadinessArgs,
): MemoInputReadiness {
  const {
    dealId,
    borrowerStory,
    management,
    collateral,
    financialFacts,
    research,
    conflicts,
    unfinalizedDocCount = 0,
    policyExceptionsReviewed = true,
  } = args;
  const now = args.now ?? new Date();

  const blockers: MemoInputBlocker[] = [];
  const warnings: MemoInputWarning[] = [];

  // ── 1. Borrower story ─────────────────────────────────────────────────
  const businessDescription = (borrowerStory?.business_description ?? "").trim();
  const revenueModel = (borrowerStory?.revenue_model ?? "").trim();

  if (businessDescription.length < BUSINESS_DESCRIPTION_MIN) {
    blockers.push({
      code: "missing_business_description",
      label: "Business description is required",
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#borrower-story`,
    });
  }
  if (revenueModel.length < REVENUE_MODEL_MIN) {
    blockers.push({
      code: "missing_revenue_model",
      label: "Revenue model is required",
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#borrower-story`,
    });
  }

  const borrowerStoryComplete =
    businessDescription.length >= BUSINESS_DESCRIPTION_MIN &&
    revenueModel.length >= REVENUE_MODEL_MIN;

  if (borrowerStory && borrowerStoryComplete && !hasMinimalNarrative(borrowerStory)) {
    warnings.push({
      code: "borrower_story_incomplete",
      label: "Borrower story is missing optional context fields",
      fixPath: `/deals/${dealId}/memo-inputs#borrower-story`,
    });
  }

  // ── 2. Management ─────────────────────────────────────────────────────
  if (management.length === 0) {
    blockers.push({
      code: "missing_management_profile",
      label: "At least one management profile is required",
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#management`,
    });
  } else if (!management.some(hasUsefulProfile)) {
    warnings.push({
      code: "management_profile_thin",
      label: "Management profile lacks experience or credit relevance detail",
      fixPath: `/deals/${dealId}/memo-inputs#management`,
    });
  }
  const managementComplete = management.length > 0;

  // ── 3. Collateral ─────────────────────────────────────────────────────
  if (collateral.length === 0) {
    blockers.push({
      code: "missing_collateral_item",
      label: "Collateral analysis is required",
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#collateral`,
    });
  }
  const anyCollateralValued = collateral.some((c) => valuationOf(c) !== null);
  if (collateral.length > 0 && !anyCollateralValued) {
    blockers.push({
      code: "missing_collateral_value",
      label: "At least one collateral item must have a market or appraised value",
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#collateral`,
    });
  }
  const collateralComplete = collateral.length > 0 && anyCollateralValued;

  if (collateral.some((c) => c.requires_review)) {
    warnings.push({
      code: "collateral_requires_review",
      label: "Some collateral items require banker review (low extraction confidence)",
      fixPath: `/deals/${dealId}/memo-inputs#collateral`,
    });
  }

  // ── 4. Financial facts ────────────────────────────────────────────────
  if (financialFacts.dscr === null) {
    blockers.push({
      code: "missing_dscr",
      label: "DSCR has not been computed",
      owner: "buddy",
      fixPath: `/deals/${dealId}/spreads`,
    });
  }
  if (financialFacts.annualDebtService === null) {
    blockers.push({
      code: "missing_debt_service_facts",
      label: "Annual debt service must be computed",
      owner: "buddy",
      fixPath: `/deals/${dealId}/financials`,
    });
  }
  if (financialFacts.globalCashFlow === null) {
    blockers.push({
      code: "missing_global_cash_flow",
      label: "Global cash flow must be computed",
      owner: "buddy",
      fixPath: `/deals/${dealId}/spreads`,
    });
  }
  const financialsComplete =
    financialFacts.dscr !== null &&
    financialFacts.annualDebtService !== null &&
    financialFacts.globalCashFlow !== null;

  // ── 5. Research ───────────────────────────────────────────────────────
  if (!research || !research.gate_passed) {
    blockers.push({
      code: "missing_research_quality_gate",
      label: "Research quality gate must pass",
      owner: "buddy",
      fixPath: `/deals/${dealId}/research`,
    });
  } else if (research.trust_grade === "preliminary") {
    warnings.push({
      code: "low_research_quality",
      label: "Research is preliminary — committee-grade research is recommended",
      fixPath: `/deals/${dealId}/research`,
    });
  }
  const researchComplete = !!research?.gate_passed;

  // ── 6. Fact conflicts ─────────────────────────────────────────────────
  // 'open' blocks. 'acknowledged', 'resolved', and 'ignored' do not.
  const openConflicts = conflicts.filter((c) => c.status === "open");
  if (openConflicts.length > 0) {
    blockers.push({
      code: "open_fact_conflicts",
      label: `${openConflicts.length} open fact conflict${
        openConflicts.length === 1 ? "" : "s"
      } must be resolved or acknowledged`,
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#conflicts`,
    });
  }
  const conflictsResolved = openConflicts.length === 0;

  // ── 7. Other gates ────────────────────────────────────────────────────
  if (unfinalizedDocCount > 0) {
    blockers.push({
      code: "unfinalized_required_documents",
      label: `${unfinalizedDocCount} required document${
        unfinalizedDocCount === 1 ? " is" : "s are"
      } not finalized`,
      owner: "banker",
      fixPath: `/deals/${dealId}/intake`,
    });
  }
  if (!policyExceptionsReviewed) {
    blockers.push({
      code: "missing_policy_exception_review",
      label: "Policy exceptions must be reviewed",
      owner: "banker",
      fixPath: `/deals/${dealId}/policy-exceptions`,
    });
  }

  // ── Score & contract output ───────────────────────────────────────────
  const readiness_score = computeReadinessScore(blockers);

  return {
    ready: blockers.length === 0,
    borrower_story_complete: borrowerStoryComplete,
    management_complete: managementComplete,
    collateral_complete: collateralComplete,
    financials_complete: financialsComplete,
    research_complete: researchComplete,
    conflicts_resolved: conflictsResolved,
    readiness_score,
    blockers,
    warnings,
    evaluatedAt: now.toISOString(),
    contractVersion: "memo_input_v1",
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function computeReadinessScore(blockers: MemoInputBlocker[]): number {
  if (blockers.length === 0) return READINESS_CEILING;
  let deduction = 0;
  for (const b of blockers) {
    deduction += BLOCKER_WEIGHTS[b.code] ?? 5;
  }
  return Math.max(READINESS_FLOOR, READINESS_CEILING - deduction);
}

function valuationOf(c: {
  market_value: number | null;
  appraised_value: number | null;
  discounted_value: number | null;
}): number | null {
  if (typeof c.appraised_value === "number" && c.appraised_value > 0) {
    return c.appraised_value;
  }
  if (typeof c.market_value === "number" && c.market_value > 0) {
    return c.market_value;
  }
  if (typeof c.discounted_value === "number" && c.discounted_value > 0) {
    return c.discounted_value;
  }
  return null;
}

function hasUsefulProfile(p: {
  years_experience: number | null;
  industry_experience: string | null;
  prior_business_experience: string | null;
  resume_summary: string | null;
  credit_relevance: string | null;
}): boolean {
  if (typeof p.years_experience === "number" && p.years_experience > 0) return true;
  return [
    p.industry_experience,
    p.prior_business_experience,
    p.resume_summary,
    p.credit_relevance,
  ].some((v) => typeof v === "string" && v.trim().length >= 20);
}

function hasMinimalNarrative(s: {
  customers: string | null;
  competitive_position: string | null;
  key_risks: string | null;
}): boolean {
  return [s.customers, s.competitive_position, s.key_risks].some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
}
