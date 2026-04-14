// Pure function. No DB. No side effects. No network.
import type { EligibilityInput, UnderwritingEligibility } from "./types";

const BLOCKING_BLOCKER_CODES = new Set([
  "loan_request_missing",
  "loan_request_incomplete",
  "documents_require_review",
  "required_documents_missing",
]);

const QUICK_LOOK_BLOCKING_CODES = new Set([
  "loan_request_missing",
  "loan_request_incomplete",
  "documents_require_review",
]);

/**
 * Determine whether a deal is eligible for underwriting launch.
 * Derives purely from canonical truth.
 */
export function computeUnderwritingEligibility(
  input: EligibilityInput,
): UnderwritingEligibility {
  const reasonsNotReady: string[] = [];
  const warnings: string[] = [];

  // Check for blocking blockers
  const effectiveCodes =
    input.dealMode === "quick_look" ? QUICK_LOOK_BLOCKING_CODES : BLOCKING_BLOCKER_CODES;
  const blockingBlockers = input.blockers.filter((b) =>
    effectiveCodes.has(b.code),
  );
  if (blockingBlockers.length > 0) {
    for (const b of blockingBlockers) {
      reasonsNotReady.push(`Blocker: ${b.code.replace(/_/g, " ")}`);
    }
  }

  // Loan request must be complete
  if (input.loanRequestStatus === "missing") {
    reasonsNotReady.push("No loan request has been created");
  } else if (input.loanRequestStatus === "draft") {
    reasonsNotReady.push("Loan request is incomplete");
  }

  // Deal identity must be valid
  if (!input.hasDealName) reasonsNotReady.push("Deal name is missing");
  if (!input.hasBorrowerId) reasonsNotReady.push("Borrower is not linked");
  if (!input.hasBankId) reasonsNotReady.push("Bank is not set");

  // All applicable required requirements must be satisfied
  if (input.applicableRequiredSatisfiedCount < input.applicableRequiredTotalCount) {
    const missing = input.applicableRequiredTotalCount - input.applicableRequiredSatisfiedCount;
    reasonsNotReady.push(
      `${missing} applicable required requirement${missing > 1 ? "s" : ""} not yet satisfied`,
    );
  }

  // Determine status
  let status: UnderwritingEligibility["status"];
  if (input.hasExistingWorkspace && input.hasDrift) {
    status = "launched_with_drift";
  } else if (input.hasExistingWorkspace) {
    status = "launched";
  } else if (reasonsNotReady.length === 0) {
    status = "eligible";
  } else {
    status = "not_ready";
  }

  // Warnings
  if (input.applicableRequiredSatisfiedCount > 0 && reasonsNotReady.length === 0) {
    // All good — no warnings needed
  }

  return {
    status,
    canLaunch: reasonsNotReady.length === 0 && !input.hasExistingWorkspace,
    reasonsNotReady,
    warnings,
    certifiedRequirementCount: input.applicableRequiredSatisfiedCount,
    totalApplicableRequiredCount: input.applicableRequiredTotalCount,
  };
}
