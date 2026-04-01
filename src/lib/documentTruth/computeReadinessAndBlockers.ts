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

export type ReadinessInput = {
  requirements: RequirementStatusInput[];
  hasLoanRequest: boolean;
  hasSpreads: boolean;
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

  // Other categories
  const spreadsStatus: ReadinessCategoryStatus = input.hasSpreads ? "complete" : "warning";
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
