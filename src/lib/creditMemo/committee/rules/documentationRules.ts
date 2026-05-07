// Pure documentation / readiness rules.
//
// These project the memo-input layer's blockers into committee-anticipation
// language so the rail and the credit-memo page show one consistent story.

import type { CommitteeObjection, CommitteeRule } from "../types";

const BLOCKER_TO_OBJECTION: Record<
  string,
  { label: string; rationale: string; fixPath: (dealId: string) => string }
> = {
  missing_business_description: {
    label: "Borrower story not certified",
    rationale:
      "Committee opens with the borrower narrative — without a banker-certified description there is no opening.",
    fixPath: (d) => `/deals/${d}/memo-inputs#borrower-story`,
  },
  missing_revenue_model: {
    label: "Revenue model not documented",
    rationale:
      "Committee will ask 'how does this borrower make money' first — the revenue model section is empty.",
    fixPath: (d) => `/deals/${d}/memo-inputs#borrower-story`,
  },
  missing_management_profile: {
    label: "No management profile on file",
    rationale:
      "Committee scrutinizes principals individually — at least one banker-certified profile is required.",
    fixPath: (d) => `/deals/${d}/memo-inputs#management`,
  },
  missing_collateral_item: {
    label: "Collateral analysis missing",
    rationale:
      "Committee cannot assess recovery without at least one collateral item documented.",
    fixPath: (d) => `/deals/${d}/memo-inputs#collateral`,
  },
  missing_collateral_value: {
    label: "Collateral lacks values",
    rationale:
      "Committee will not approve against unvalued collateral.",
    fixPath: (d) => `/deals/${d}/memo-inputs#collateral`,
  },
  missing_research_quality_gate: {
    label: "Research has not passed quality gate",
    rationale:
      "Committee expects industry / market context — research quality gate has not passed.",
    fixPath: (d) => `/deals/${d}/research`,
  },
  open_fact_conflicts: {
    label: "Open fact conflicts",
    rationale:
      "Conflicting financial facts across sources will draw immediate committee challenge — resolve or acknowledge before submission.",
    fixPath: (d) => `/deals/${d}/memo-inputs#conflicts`,
  },
  missing_policy_exception_review: {
    label: "Policy exceptions not reviewed",
    rationale: "Open policy exceptions must be reviewed before committee.",
    fixPath: (d) => `/deals/${d}/policy-exceptions`,
  },
  unfinalized_required_documents: {
    label: "Required documents not finalized",
    rationale:
      "Committee package depends on finalized documents — extraction is still in flight.",
    fixPath: (d) => `/deals/${d}/intake`,
  },
};

export const documentationRules: CommitteeRule = (inputs) => {
  const out: CommitteeObjection[] = [];
  const dealId = inputs.dealId;

  for (const code of inputs.memoInput.blockerCodes) {
    const def = BLOCKER_TO_OBJECTION[code];
    if (!def) continue;
    out.push({
      code: `documentation_${code}`,
      domain: "documentation",
      severity: "hard",
      label: def.label,
      rationale: def.rationale,
      fixPath: def.fixPath(dealId),
      source: { metric: "memo_input_blocker", value: code },
    });
  }

  if (inputs.memoInput.openConflictsCount > 0) {
    // already covered above when the blocker code is present; only add if
    // the blocker is missing but conflicts exist (defensive).
    if (
      !out.some((o) => o.code === "documentation_open_fact_conflicts")
    ) {
      out.push({
        code: "documentation_open_fact_conflicts_residual",
        domain: "documentation",
        severity: "soft",
        label: `${inputs.memoInput.openConflictsCount} unresolved fact conflict(s)`,
        rationale:
          "Conflicts remain in the deal even though the lifecycle blocker did not surface them.",
        fixPath: `/deals/${dealId}/memo-inputs#conflicts`,
        source: {
          metric: "open_fact_conflicts_count",
          value: inputs.memoInput.openConflictsCount,
        },
      });
    }
  }

  return out;
};
