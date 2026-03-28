/**
 * Phase 65J — Annual Review & Renewal Engine Types
 *
 * Recurring credit review must be deterministic, evidence-based, lifecycle-aware.
 * No Omega dependency. Borrower submissions ≠ banker-complete review.
 */

// ── Case Types ──────────────────────────────────────────────────────────

export type ReviewCaseType = "annual_review" | "renewal";

export type ReviewCaseStatus =
  | "seeded"
  | "requesting"
  | "collecting"
  | "under_review"
  | "ready"
  | "completed"
  | "waived"
  | "decision_pending"
  | "cancelled";

export type ReviewReadinessState =
  | "not_started"
  | "missing_borrower_items"
  | "missing_banker_review"
  | "exception_open"
  | "ready";

// ── Requirements ────────────────────────────────────────────────────────

export type ReviewRequirementStatus =
  | "pending"
  | "requested"
  | "submitted"
  | "under_review"
  | "completed"
  | "waived";

export type ReviewRequirementCode =
  | "annual_financial_statements"
  | "interim_financials"
  | "tax_returns"
  | "covenant_certificate"
  | "insurance_certificate"
  | "rent_roll"
  | "compliance_review"
  | "risk_rating_refresh"
  | "financial_snapshot_refresh"
  | "renewal_structure_review"
  | "maturity_confirmation"
  | "exception_resolution"
  | "custom";

// ── Summaries ───────────────────────────────────────────────────────────

export type ReviewCaseSummary = {
  dealId: string;
  caseType: ReviewCaseType;
  caseId: string;
  status: ReviewCaseStatus;
  readinessState: ReviewReadinessState;
  dueAt: string;
  borrowerCampaignId: string | null;
  pendingRequirementCount: number;
  underReviewRequirementCount: number;
  openExceptionCount: number;
};

export type ReviewRequirement = {
  id: string;
  requirementCode: string;
  title: string;
  description: string;
  borrowerVisible: boolean;
  status: ReviewRequirementStatus;
  required: boolean;
  evidenceType: string;
};

// ── Queue ───────────────────────────────────────────────────────────────

export type ReviewBlockingParty =
  | "borrower"
  | "banker"
  | "buddy"
  | "mixed"
  | "unknown";

export type ReviewQueueItem = {
  dealId: string;
  caseType: ReviewCaseType;
  caseId: string;
  reasonCode: string;
  severity: "watch" | "urgent" | "critical";
  blockingParty: ReviewBlockingParty;
  href: string | null;
};
