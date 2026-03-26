/**
 * Phase 54C — Borrower-Safe Review Outcome Explanation
 *
 * Generates controlled borrower-facing feedback when evidence is
 * rejected, partially accepted, or requires clarification.
 * Never exposes internal reviewer notes.
 *
 * Pure function — no DB calls.
 */

import type { EvidenceReviewState, ReviewReasonCategory } from "@/lib/review/evidence-review-types";

export type ReviewOutcomeExplanation = {
  borrowerTitle: string;
  borrowerExplanation: string;
  whatWeReceived: string;
  whatIsStillNeeded: string;
  actionCta: string | null;
  urgency: "critical" | "high" | "medium" | "low";
};

type ReviewOutcomeInput = {
  reviewState: EvidenceReviewState;
  conditionTitle: string;
  reasonCategory: ReviewReasonCategory | null;
  explanationBorrowerSafe: string | null;
  requestedClarification: string | null;
  whatStillNeeded: string | null;
  documentFilename: string | null;
};

/**
 * Generate borrower-safe explanation from a review outcome.
 */
export function explainReviewOutcomeForBorrower(input: ReviewOutcomeInput): ReviewOutcomeExplanation {
  const { reviewState, conditionTitle, reasonCategory, explanationBorrowerSafe, requestedClarification, whatStillNeeded, documentFilename } = input;

  const docRef = documentFilename ? `"${documentFilename}"` : "your uploaded document";

  switch (reviewState) {
    case "accepted":
      return {
        borrowerTitle: `${conditionTitle} — Accepted`,
        borrowerExplanation: `${docRef} has been reviewed and accepted. No further action needed for this item.`,
        whatWeReceived: docRef,
        whatIsStillNeeded: "Nothing — this item is complete.",
        actionCta: null,
        urgency: "low",
      };

    case "partially_accepted":
      return {
        borrowerTitle: `${conditionTitle} — Partially Complete`,
        borrowerExplanation: explanationBorrowerSafe
          ?? `We reviewed ${docRef} and part of the requirement is now met, but additional documentation is still needed.`,
        whatWeReceived: docRef,
        whatIsStillNeeded: whatStillNeeded ?? "Additional documentation is needed. Please check your condition details.",
        actionCta: "Upload More",
        urgency: "high",
      };

    case "rejected":
      return {
        borrowerTitle: `${conditionTitle} — Not Accepted`,
        borrowerExplanation: explanationBorrowerSafe
          ?? buildRejectionExplanation(conditionTitle, reasonCategory, docRef),
        whatWeReceived: `${docRef} (not accepted)`,
        whatIsStillNeeded: `Please upload a replacement document for "${conditionTitle}"`,
        actionCta: "Re-upload",
        urgency: "critical",
      };

    case "clarification_requested":
      return {
        borrowerTitle: `${conditionTitle} — Clarification Needed`,
        borrowerExplanation: requestedClarification
          ?? explanationBorrowerSafe
          ?? `We need additional information about ${docRef} before we can accept it.`,
        whatWeReceived: docRef,
        whatIsStillNeeded: requestedClarification ?? "Please provide the requested clarification or upload a clearer document.",
        actionCta: "Respond",
        urgency: "high",
      };

    case "waived":
      return {
        borrowerTitle: `${conditionTitle} — Waived`,
        borrowerExplanation: "This requirement has been waived. No further action is needed.",
        whatWeReceived: docRef,
        whatIsStillNeeded: "Nothing — this item has been waived.",
        actionCta: null,
        urgency: "low",
      };

    default:
      return {
        borrowerTitle: conditionTitle,
        borrowerExplanation: "This item is being reviewed.",
        whatWeReceived: docRef,
        whatIsStillNeeded: "No action needed right now.",
        actionCta: null,
        urgency: "low",
      };
  }
}

function buildRejectionExplanation(
  title: string,
  category: ReviewReasonCategory | null,
  docRef: string,
): string {
  const reasons: Record<string, string> = {
    wrong_document_type: `${docRef} is not the type of document needed for "${title}". Please upload the correct document.`,
    wrong_date_range: `${docRef} covers the wrong time period. Please upload a document covering the required dates.`,
    wrong_entity: `${docRef} appears to be for a different business or person. Please upload the document for the correct entity.`,
    incomplete_document: `${docRef} appears to be incomplete or missing pages. Please upload the complete document.`,
    unreadable: `${docRef} was not readable. Please try uploading a clearer scan or photo.`,
    missing_signature_or_page: `${docRef} is missing a required signature or page. Please upload a complete, signed version.`,
    insufficient_detail: `${docRef} does not contain enough detail to satisfy this requirement.`,
    conflicting_information: `${docRef} contains information that conflicts with other documents. Please review and re-upload.`,
    duplicate_submission: `${docRef} was already submitted. Please upload a different document if additional evidence is needed.`,
  };

  return category && reasons[category]
    ? reasons[category]
    : `${docRef} did not meet the requirements for "${title}". Please review the condition details and upload a replacement.`;
}
