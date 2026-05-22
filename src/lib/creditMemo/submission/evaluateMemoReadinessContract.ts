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
import { buildRequiredItems } from "@/lib/creditMemo/review/bankerReviewReadiness";

// Re-export so callers may import directly from this module.
export type { MemoReadinessContract } from "./types";

export function evaluateMemoReadinessContract(args: {
  memo: CanonicalCreditMemoV1;
  overrides: Record<string, unknown>;
  now?: Date;
}): MemoReadinessContract {
  const { memo, overrides } = args;
  const now = args.now ?? new Date();

  // ── Required items — canonical-first, mirrors BankerReviewPanel.tsx ────
  // Uses the shared helper so client UI and server gate stay in lockstep.
  const items = buildRequiredItems(memo, overrides);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const required = {
    dscr_computed: itemById.get("dscr")?.ok ?? false,
    loan_amount: itemById.get("loan")?.ok ?? false,
    collateral_value: itemById.get("collat")?.ok ?? false,
    business_description: itemById.get("bizdesc")?.ok ?? false,
    management_bio: itemById.get("mgmtbio")?.ok ?? false,
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
      label: "Collateral is not available",
      owner: "banker",
      fixHref: `/deals/${memo.deal_id}/collateral`,
    });
  }
  if (!required.business_description) {
    blockers.push({
      code: "business_description",
      label: "Business profile is not available",
      owner: "banker",
      fixHref: `/credit-memo/${memo.deal_id}/canonical`,
    });
  }
  if (!required.management_bio) {
    blockers.push({
      code: "management_bio",
      label: "Management profile is not available",
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
