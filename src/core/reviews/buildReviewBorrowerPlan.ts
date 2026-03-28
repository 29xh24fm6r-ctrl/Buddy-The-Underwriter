/**
 * Phase 65J — Build Review Borrower Plan
 *
 * Only borrower-visible requirements become campaign items.
 * No internal jargon leaks. Pure function.
 */

import type { ReviewCaseType, ReviewRequirement } from "./types";

export type BorrowerPlanItem = {
  itemCode: string;
  title: string;
  description: string;
  required: boolean;
  evidenceType: string;
};

export type ReviewBorrowerPlan = {
  caseType: ReviewCaseType;
  campaignTitle: string;
  items: BorrowerPlanItem[];
};

export function buildReviewBorrowerPlan(
  caseType: ReviewCaseType,
  requirements: ReviewRequirement[],
): ReviewBorrowerPlan {
  const borrowerItems = requirements
    .filter((r) => r.borrowerVisible && r.status === "pending")
    .map((r) => ({
      itemCode: r.requirementCode,
      title: r.title,
      description: r.description,
      required: r.required,
      evidenceType: r.evidenceType,
    }));

  const campaignTitle =
    caseType === "annual_review"
      ? "Annual Review — Document Request"
      : "Loan Renewal — Document Request";

  return {
    caseType,
    campaignTitle,
    items: borrowerItems,
  };
}
