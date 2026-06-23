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
  missing_business_cash_flow: 12,
  missing_dscr: 12,
  missing_debt_service_facts: 10,
  missing_global_cash_flow: 8,
  missing_research_quality_gate: 8,
  open_fact_conflicts: 6,
  unfinalized_required_documents: 4,
  missing_policy_exception_review: 2,
  missing_ar_borrowing_base: 8,
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
  // ACTIVATION: Accept snapshot collateral or AR borrowing base as alternatives
  const hasSnapshotOrAr = args.hasSnapshotCollateral === true || args.hasArBorrowingBase === true;
  if (collateral.length === 0 && !hasSnapshotOrAr) {
    blockers.push({
      code: "missing_collateral_item",
      label: "Collateral analysis is required",
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#collateral`,
    });
  }
  const anyCollateralValued = collateral.some((c) => valuationOf(c) !== null);
  if (collateral.length > 0 && !anyCollateralValued && !hasSnapshotOrAr) {
    blockers.push({
      code: "missing_collateral_value",
      label: "At least one collateral item must have a market or appraised value",
      owner: "banker",
      fixPath: `/deals/${dealId}/memo-inputs#collateral`,
    });
  }
  const collateralComplete = (collateral.length > 0 && anyCollateralValued) || hasSnapshotOrAr;

  if (collateral.some((c) => c.requires_review)) {
    warnings.push({
      code: "collateral_requires_review",
      label: "Some collateral items require banker review (low extraction confidence)",
      fixPath: `/deals/${dealId}/memo-inputs#collateral`,
    });
  }

  // ── 3b. AR Borrowing Base (conditional on collateral type) ─────────
  if (args.isArLocDeal && !args.hasArBorrowingBase) {
    blockers.push({
      code: "missing_ar_borrowing_base",
      label: "AR borrowing base analysis is required for AR/LOC collateral type",
      owner: "buddy",
      fixPath: `/deals/${dealId}/underwriting-synthesis`,
    });
  }

  // ── 4. Financial facts ────────────────────────────────────────────────
  // SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: GCF is a DOWNSTREAM aggregate.
  // Emit financial blockers in dependency order — business cash flow →
  // annual debt service → global cash flow → DSCR (most downstream LAST) — so
  // the Memo Inputs panel (which presents blockers[0] as the next action) never
  // surfaces GCF/DSCR ahead of the upstream financial analysis that feeds them.
  //
  // GCF / DSCR fixPaths route to the EARLIEST unresolved upstream step (business
  // cash flow / ADS / personal-PFS) when GCF prerequisites are not yet ready,
  // instead of dead-ending on the GCF compute page that can't compute yet.
  const gcfPrereqs = args.gcfPrerequisites;
  const gcfFixPath =
    gcfPrereqs && !gcfPrereqs.ready && gcfPrereqs.earliestMissing
      ? `/deals/${dealId}${gcfPrereqs.earliestMissing.fixPathSuffix}`
      : `/deals/${dealId}/spreads/global-cash-flow`;

  // 1. Business cash flow — earliest upstream prerequisite.
  if (financialFacts.cashFlowAvailable === null) {
    blockers.push({
      code: "missing_business_cash_flow",
      label: "Business cash flow must be computed",
      owner: "buddy",
      fixPath: `/deals/${dealId}/financials`,
    });
  }
  // 2. Annual debt service.
  if (financialFacts.annualDebtService === null) {
    blockers.push({
      code: "missing_debt_service_facts",
      label: "Annual debt service must be computed",
      owner: "buddy",
      fixPath: `/deals/${dealId}/financials`,
    });
  }
  // 3. Global cash flow (downstream aggregate). Routes upstream when blocked.
  if (financialFacts.globalCashFlow === null) {
    blockers.push({
      code: "missing_global_cash_flow",
      label:
        gcfPrereqs && !gcfPrereqs.ready
          ? "Global cash flow blocked — run upstream financial analysis first"
          : "Global cash flow must be computed",
      owner: "buddy",
      fixPath: gcfFixPath,
    });
  }
  // 4. DSCR — most downstream financial metric, presented LAST.
  if (financialFacts.dscr === null) {
    blockers.push({
      code: "missing_dscr",
      label: "DSCR has not been computed",
      owner: "buddy",
      // SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: DSCR depends on GCF, which depends
      // on the upstream financial facts. Route to the earliest unresolved upstream
      // step, NOT blindly to the GCF compute page (which can't clear DSCR yet).
      fixPath: gcfFixPath,
    });
  } else if (args.dscrSource === "proxy") {
    // ACTIVATION: DSCR exists but from proxy/fallback — warn, don't block
    warnings.push({
      code: "dscr_proxy_source",
      label: "DSCR is computed from proxy (T12/structural) — authoritative spread-based DSCR recommended",
      fixPath: `/deals/${dealId}/spreads`,
    });
  }
  const financialsComplete =
    financialFacts.cashFlowAvailable !== null &&
    financialFacts.dscr !== null &&
    financialFacts.annualDebtService !== null &&
    financialFacts.globalCashFlow !== null;

  // ── 5. Research ───────────────────────────────────────────────────────
  if (!research || !research.gate_passed) {
    blockers.push({
      code: "missing_research_quality_gate",
      label: "Research quality gate must pass",
      owner: "buddy",
      fixPath: `/deals/${dealId}/underwrite`,
    });
  } else if (research.trust_grade === "preliminary") {
    warnings.push({
      code: "low_research_quality",
      label: "Research is preliminary — committee-grade research is recommended",
      fixPath: `/deals/${dealId}/underwrite`,
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
      label: `Buddy is still processing ${unfinalizedDocCount} required document${
        unfinalizedDocCount === 1 ? "" : "s"
      }`,
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
