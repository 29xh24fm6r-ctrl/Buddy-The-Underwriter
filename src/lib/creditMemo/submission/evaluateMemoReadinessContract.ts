// Pure readiness contract evaluation for credit memo submission.
//
// This is the SERVER-SIDE gate that mirrors and supersedes the UI-only
// checklist in BankerReviewPanel.tsx. The required item set must stay in
// lockstep with that component — adding a server requirement here without
// matching the UI will reject submissions that the banker thinks are ready.
//
// Rule: only Buddy assembles. Banker submits. This contract decides
// whether the banker may submit.

import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type {
  MemoReadinessContract,
  ReadinessBlocker,
  ReadinessWarning,
} from "./types";

// Re-export so callers may import directly from this module.
export type { MemoReadinessContract } from "./types";

const BUSINESS_DESCRIPTION_MIN = 20;
const MANAGEMENT_BIO_MIN = 20;

export function evaluateMemoReadinessContract(args: {
  memo: CanonicalCreditMemoV1;
  overrides: Record<string, unknown>;
  now?: Date;
}): MemoReadinessContract {
  const { memo, overrides } = args;
  const now = args.now ?? new Date();

  // ── Required items (mirrors BankerReviewPanel.tsx) ─────────────────────
  const dscrOk = memo.financial_analysis.dscr.value !== null;

  const loanOk =
    memo.key_metrics.loan_amount.value !== null &&
    memo.key_metrics.loan_amount.value > 0;

  const collateralOk =
    memo.collateral.gross_value.value !== null &&
    memo.collateral.gross_value.value > 0;

  const businessDescription = overrides["business_description"];
  const businessDescriptionOk =
    typeof businessDescription === "string" &&
    businessDescription.trim().length >= BUSINESS_DESCRIPTION_MIN;

  const principalIds = memo.management_qualifications.principals.map((p) => p.id);
  const managementBioOk = principalIds.some((pid) => {
    const value = overrides[`principal_bio_${pid}`];
    return (
      typeof value === "string" && value.trim().length >= MANAGEMENT_BIO_MIN
    );
  });

  const required = {
    dscr_computed: dscrOk,
    loan_amount: loanOk,
    collateral_value: collateralOk,
    business_description: businessDescriptionOk,
    management_bio: managementBioOk,
  };

  // ── Warnings (do not block submission, but recorded with the snapshot) ─
  const narrative = memo.executive_summary?.narrative;
  const narrativeOk =
    typeof narrative === "string" &&
    narrative.length > 0 &&
    !narrative.toLowerCase().includes("not yet generated");

  const researchOk = memo.business_industry_analysis !== null;

  const tabsViewed = (() => {
    const raw = overrides["tabs_viewed"];
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
  })();

  const covenantReviewOk = tabsViewed.includes("covenants");
  const qualitativeReviewOk = tabsViewed.includes("qualitative");

  const warnings = {
    ai_narrative_missing: !narrativeOk,
    research_missing: !researchOk,
    covenant_review_missing: !covenantReviewOk,
    qualitative_review_missing: !qualitativeReviewOk,
  };

  // ── Build blocker list ────────────────────────────────────────────────
  const blockers: ReadinessBlocker[] = [];
  if (!required.dscr_computed) {
    blockers.push({
      code: "dscr_computed",
      label: "DSCR has not been computed",
      owner: "buddy",
      fixHref: `/deals/${memo.deal_id}/spreads`,
    });
  }
  if (!required.loan_amount) {
    blockers.push({
      code: "loan_amount",
      label: "Loan amount is missing",
      owner: "banker",
      fixHref: `/deals/${memo.deal_id}/loan-request`,
    });
  }
  if (!required.collateral_value) {
    blockers.push({
      code: "collateral_value",
      label: "Collateral value has not been entered",
      owner: "banker",
      fixHref: `/deals/${memo.deal_id}/collateral`,
    });
  }
  if (!required.business_description) {
    blockers.push({
      code: "business_description",
      label: `Business description must be at least ${BUSINESS_DESCRIPTION_MIN} characters`,
      owner: "banker",
      fixHref: `/credit-memo/${memo.deal_id}/canonical`,
    });
  }
  if (!required.management_bio) {
    blockers.push({
      code: "management_bio",
      label: `At least one management bio must be at least ${MANAGEMENT_BIO_MIN} characters`,
      owner: "banker",
      fixHref: `/credit-memo/${memo.deal_id}/canonical`,
    });
  }

  const warningList: ReadinessWarning[] = [];
  if (warnings.ai_narrative_missing) {
    warningList.push({ code: "ai_narrative_missing", label: "AI narrative not generated" });
  }
  if (warnings.research_missing) {
    warningList.push({ code: "research_missing", label: "Research has not been run" });
  }
  if (warnings.covenant_review_missing) {
    warningList.push({ code: "covenant_review_missing", label: "Covenant package not reviewed" });
  }
  if (warnings.qualitative_review_missing) {
    warningList.push({ code: "qualitative_review_missing", label: "Qualitative assessment not reviewed" });
  }

  const passed = blockers.length === 0;

  return {
    passed,
    required,
    warnings,
    blockers,
    warningList,
    evaluatedAt: now.toISOString(),
    contractVersion: "memo_readiness_v1",
  };
}
