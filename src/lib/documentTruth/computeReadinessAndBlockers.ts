// Pure function. No DB. No side effects. No network.
// Computes readiness categories and blockers from canonical requirement state.

export type ReadinessCategory =
  | "documents"
  | "spreads"
  | "loan_request"
  | "risk_pricing"
  | "underwriting"
  | "ai_pipeline"
  | "pricing_setup"
  | "financials"
  | "pricing_quote"
  | "decision";

export type ReadinessCategoryStatus = "blocking" | "warning" | "complete";

export type Blocker = {
  code: string;
  severity: "blocking" | "warning";
  title: string;
  details: string[];
  actionLabel: string;
};

export type RequirementStatusInput = {
  code: string;
  label: string;
  group: string;
  required: boolean;
  applicable: boolean;
  checklistStatus: "missing" | "received" | "satisfied" | "waived";
  reviewPending: boolean;
  matchedDocumentCount: number;
};

/**
 * Honest spread stats for the readiness panel (STUCK-SPREADS Batch 3).
 *
 * `total`       — count of deal_spreads rows for this deal
 * `terminal`    — count in status ∈ {ready, error}
 * `stuck`       — count in status ∈ {queued, generating} that exceeded the
 *                 staleness threshold (typically 5 minutes). These are the
 *                 rows that previously masqueraded as "complete" because
 *                 hasSpreads was true.
 * `stuckTypes`  — spread_type values for each stuck row; surfaced in the
 *                 blocker detail so the operator sees which spread is stuck.
 *
 * When `total === 0` the category is a "warning" (nothing to show yet).
 * When `stuck > 0` the category is a "warning" (honest about the stuck row).
 * Otherwise "complete" iff terminal === total.
 */
export type SpreadStats = {
  total: number;
  terminal: number;
  stuck: number;
  stuckTypes: string[];
};

export type ReadinessInput = {
  requirements: RequirementStatusInput[];
  hasLoanRequest: boolean;
  spreadStats: SpreadStats;
  hasFinancialSnapshot: boolean;
  hasPricingQuote: boolean;
  hasDecision: boolean;
};

/**
 * Compute readiness categories and explicit blockers.
 * Readiness is requirement-derived, not panel-derived.
 */
export function computeReadinessAndBlockers(input: ReadinessInput): {
  categories: Array<{ code: ReadinessCategory; status: ReadinessCategoryStatus }>;
  blockers: Blocker[];
  readinessPercent: number;
} {
  const blockers: Blocker[] = [];

  // Document readiness
  // Exclude loan_request group — it is tracked separately via hasLoanRequest / lrBlocker.
  // Keeping it here produces a duplicate in "Missing: N required documents".
  const applicableRequired = input.requirements.filter(
    (r) => r.applicable && r.required && r.group !== "loan_request",
  );
  const missingRequired = applicableRequired.filter((r) => r.checklistStatus === "missing");
  const reviewRequired = applicableRequired.filter((r) => r.reviewPending && r.checklistStatus !== "waived");
  const satisfiedRequired = applicableRequired.filter(
    (r) => r.checklistStatus === "satisfied" || r.checklistStatus === "waived",
  );

  let documentStatus: ReadinessCategoryStatus = "complete";

  if (missingRequired.length > 0) {
    documentStatus = "blocking";
    blockers.push({
      code: "required_documents_missing",
      severity: "blocking",
      title: `Missing: ${missingRequired.length} required document${missingRequired.length > 1 ? "s" : ""}`,
      details: missingRequired.map((r) => `Missing: ${r.label}`),
      actionLabel: "Upload Missing Documents",
    });
  }

  if (reviewRequired.length > 0) {
    if (documentStatus !== "blocking") documentStatus = "blocking";
    blockers.push({
      code: "documents_require_review",
      severity: "blocking",
      title: `Review required: ${reviewRequired.length} document${reviewRequired.length > 1 ? "s" : ""}`,
      details: reviewRequired.map((r) => `Review required: ${r.label}`),
      actionLabel: "Review Documents",
    });
  }

  // Loan request category status — blocker is emitted by cockpit-state via deriveLoanRequestBlocker.
  // Do NOT push a blocker here; cockpit-state prepends lrBlocker which is the canonical source.
  const loanRequestStatus: ReadinessCategoryStatus = input.hasLoanRequest ? "complete" : "blocking";

  // Spread readiness — honest about non-terminal (stuck) rows.
  // "Complete" requires all existing spreads to be in a terminal state
  // (ready or error). Any stuck row downgrades the category to "warning"
  // and emits a blocker listing the stuck spread types.
  const s = input.spreadStats;
  let spreadsStatus: ReadinessCategoryStatus;
  if (s.total === 0) {
    spreadsStatus = "warning";
  } else if (s.stuck > 0) {
    spreadsStatus = "warning";
  } else if (s.terminal === s.total) {
    spreadsStatus = "complete";
  } else {
    // Non-terminal rows exist but aren't yet "stuck" (under the staleness
    // threshold). Still warning — a spread that's generating is not complete.
    spreadsStatus = "warning";
  }

  if (s.stuck > 0) {
    const typeList = s.stuckTypes.join(", ");
    blockers.push({
      code: "spreads_stuck",
      severity: "warning",
      title: `Spreads stuck: ${s.stuck} of ${s.total}`,
      details: [`Stuck spread types: ${typeList || "unknown"}`],
      actionLabel: "",
    });
  }

  const financialsStatus: ReadinessCategoryStatus = input.hasFinancialSnapshot ? "complete" : "warning";
  const pricingStatus: ReadinessCategoryStatus = input.hasPricingQuote ? "complete" : "warning";
  const decisionStatus: ReadinessCategoryStatus = input.hasDecision ? "complete" : "warning";

  const categories: Array<{ code: ReadinessCategory; status: ReadinessCategoryStatus }> = [
    { code: "documents", status: documentStatus },
    { code: "loan_request", status: loanRequestStatus },
    { code: "spreads", status: spreadsStatus },
    { code: "financials", status: financialsStatus },
    { code: "pricing_quote", status: pricingStatus },
    { code: "decision", status: decisionStatus },
  ];

  // Readiness percent based on required category completion
  const requiredCategories = categories.filter(
    (c) => c.code === "documents" || c.code === "loan_request",
  );
  const completedRequired = requiredCategories.filter((c) => c.status === "complete").length;
  const docPercent = applicableRequired.length > 0
    ? Math.round((satisfiedRequired.length / applicableRequired.length) * 100)
    : 100;
  const overallPercent = Math.round(
    (docPercent * 0.7) + (input.hasLoanRequest ? 30 : 0),
  );

  return {
    categories,
    blockers,
    readinessPercent: Math.min(100, overallPercent),
  };
}
