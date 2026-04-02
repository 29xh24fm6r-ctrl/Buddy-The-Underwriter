// Pure function. No DB. No side effects.
import type { LoanRequest, LoanRequestStatus } from "./loanRequestTypes";

/**
 * Determine loan request completeness status and missing fields.
 *
 * Minimum completeness (core intake fields):
 * - loan_amount
 * - loan_purpose
 * - loan_type
 *
 * Conditional:
 * - collateral_type === "real_estate" → occupancy_type required
 * - guarantor_required === true → guarantor_notes required
 */
export function computeLoanRequestStatus(
  request: LoanRequest | null,
): {
  status: LoanRequestStatus;
  missingFields: string[];
} {
  if (!request) {
    return { status: "missing", missingFields: [] };
  }

  const missing: string[] = [];

  if (!request.loanAmount || request.loanAmount <= 0) missing.push("loan_amount");
  if (!request.loanPurpose?.trim()) missing.push("loan_purpose");
  if (!request.loanType?.trim()) missing.push("loan_type");
  // facility_purpose and collateral_type are optional at intake — required only for formal submission

  // Conditional
  if (request.collateralType === "real_estate" && !request.occupancyType?.trim()) {
    missing.push("occupancy_type");
  }
  if (request.guarantorRequired && !request.guarantorNotes?.trim()) {
    missing.push("guarantor_notes");
  }

  return {
    status: missing.length === 0 ? "complete" : "draft",
    missingFields: missing,
  };
}

/**
 * Derive blocker for loan request state.
 */
export function deriveLoanRequestBlocker(
  request: LoanRequest | null,
): {
  code: string;
  title: string;
  details: string[];
  actionLabel: string;
} | null {
  const { status, missingFields } = computeLoanRequestStatus(request);

  if (status === "missing") {
    return {
      code: "loan_request_missing",
      title: "No loan request has been created",
      details: ["A loan request is required before underwriting can proceed."],
      actionLabel: "Add Loan Request",
    };
  }

  if (status === "draft" && missingFields.length > 0) {
    return {
      code: "loan_request_incomplete",
      title: "Loan request is incomplete",
      details: missingFields.map(
        (f) => `Missing: ${f.replace(/_/g, " ")}`,
      ),
      actionLabel: "Complete Loan Request",
    };
  }

  return null;
}

/**
 * Derive next best action from blockers and readiness state.
 */
export function deriveNextBestAction(input: {
  loanRequestStatus: LoanRequestStatus;
  reviewRequiredCount: number;
  missingRequiredCount: number;
}): {
  code: string;
  title: string;
  description: string;
  ctaLabel: string;
} | null {
  if (input.loanRequestStatus === "missing") {
    return {
      code: "add_loan_request",
      title: "Create the loan request",
      description: "Buddy needs loan structure details to determine applicability and drive underwriting.",
      ctaLabel: "Add Loan Request",
    };
  }

  if (input.loanRequestStatus === "draft") {
    return {
      code: "complete_loan_request",
      title: "Complete the loan request",
      description: "Some required loan request fields are missing.",
      ctaLabel: "Complete Loan Request",
    };
  }

  if (input.reviewRequiredCount > 0) {
    return {
      code: "review_documents",
      title: `Review ${input.reviewRequiredCount} matched document${input.reviewRequiredCount > 1 ? "s" : ""} awaiting confirmation`,
      description: "Matched documents need banker review before they can satisfy requirements.",
      ctaLabel: "Review Documents",
    };
  }

  if (input.missingRequiredCount > 0) {
    return {
      code: "upload_missing_documents",
      title: `Upload ${input.missingRequiredCount} missing required document${input.missingRequiredCount > 1 ? "s" : ""}`,
      description: "Some required documents have not been received yet.",
      ctaLabel: "Upload Missing Documents",
    };
  }

  return {
    code: "open_underwriting",
    title: "Deal is ready for underwriting",
    description: "All applicable required intake items have been satisfied.",
    ctaLabel: "Open Underwriting",
  };
}

/**
 * Build plain-English banker explanation from blockers.
 */
export function buildBankerExplanation(blockers: Array<{
  code: string;
  title: string;
  details: string[];
}>): string[] {
  if (blockers.length === 0) {
    return ["This deal is ready for underwriting. All applicable required intake items have been satisfied."];
  }

  const lines: string[] = [];
  lines.push("This deal is not ready yet because:");

  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    lines.push(`${i + 1}. ${b.title}`);
  }

  lines.push("");
  lines.push("What to do next:");
  for (const b of blockers) {
    if (b.details.length > 0) {
      for (const d of b.details.slice(0, 3)) {
        lines.push(`- ${d}`);
      }
    }
  }

  return lines;
}
