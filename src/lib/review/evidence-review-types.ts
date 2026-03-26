/**
 * Phase 54C — Evidence Review Types
 *
 * Canonical types for the human review layer.
 */

export type EvidenceReviewState =
  | "queued_for_review"
  | "in_review"
  | "accepted"
  | "partially_accepted"
  | "rejected"
  | "clarification_requested"
  | "waived";

export type ReviewReasonCategory =
  | "wrong_document_type"
  | "wrong_date_range"
  | "wrong_entity"
  | "incomplete_document"
  | "unreadable"
  | "missing_signature_or_page"
  | "insufficient_detail"
  | "conflicting_information"
  | "clarification_needed"
  | "duplicate_submission"
  | "policy_exception"
  | "auto_ambiguity"
  | "other";

export type ReviewSourceOfFlag =
  | "auto_ambiguity"
  | "auto_rejection"
  | "banker_manual"
  | "borrower_follow_up";

export type EvidenceReviewItem = {
  id: string;
  dealId: string;
  bankId: string;
  conditionId: string;
  documentId: string;
  conditionDocumentLinkId: string | null;
  reviewState: EvidenceReviewState;
  reviewReasonCategory: ReviewReasonCategory | null;
  sourceOfFlag: ReviewSourceOfFlag;
  classifierConfidence: number | null;
  ambiguityFlags: Record<string, unknown> | null;
  explanationInternal: string | null;
  explanationBorrowerSafe: string | null;
  requestedClarification: string | null;
  reviewerUserId: string | null;
  reviewerMembershipId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  resolutionAppliedAt: string | null;
};

export type ReviewDecisionAction =
  | "accept"
  | "partially_accept"
  | "reject"
  | "request_clarification"
  | "waive";

export type ReviewDecisionInput = {
  reviewId: string;
  dealId: string;
  action: ReviewDecisionAction;
  /** Required for reject and request_clarification */
  explanationBorrowerSafe?: string;
  /** Required for waive */
  explanationInternal?: string;
  /** Required for partially_accept */
  whatStillNeeded?: string;
  /** Required for request_clarification */
  requestedClarification?: string;
  /** Reason category */
  reasonCategory?: ReviewReasonCategory;
  /** Actor */
  reviewerUserId: string;
  reviewerMembershipId?: string;
};
