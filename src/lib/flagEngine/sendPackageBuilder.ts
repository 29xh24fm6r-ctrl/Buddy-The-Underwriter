/**
 * Send Package Builder — assembles approved questions for borrower delivery.
 *
 * Pure function — no DB, no server imports.
 */

import type { SpreadFlag, SendPackage, BorrowerQuestion } from "./types";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function buildSendPackage(flags: SpreadFlag[], deal_name: string): SendPackage {
  // Only include flags that banker has reviewed AND have a question
  const approved = flags.filter(
    (f) => f.status === "banker_reviewed" && f.borrower_question !== null,
  );

  const questions: BorrowerQuestion[] = approved
    .map((f) => f.borrower_question!)
    .filter((q) => q !== null);

  const documentRequests = questions.filter((q) => q.document_requested);
  const generalQuestions = questions.filter((q) => !q.document_requested);

  const totalCount = questions.length;
  const docCount = documentRequests.length;

  let cover_message: string;
  if (totalCount === 0) {
    cover_message = `As part of our credit review of ${deal_name}, we have no outstanding items at this time.`;
  } else {
    const questionWord = totalCount === 1 ? "item" : "items";
    const parts: string[] = [];
    if (generalQuestions.length > 0) {
      parts.push(`${generalQuestions.length} clarification ${generalQuestions.length === 1 ? "question" : "questions"}`);
    }
    if (docCount > 0) {
      parts.push(`${docCount} document ${docCount === 1 ? "request" : "requests"}`);
    }
    cover_message = `As part of our credit review of ${deal_name}, we have ${totalCount} ${questionWord} we'd like to clarify before proceeding${parts.length > 0 ? " (" + parts.join(" and ") + ")" : ""}. Please review the questions below and respond at your earliest convenience. For any document requests, you can upload files directly through the portal link below.`;
  }

  return {
    deal_id: approved.length > 0 ? approved[0].deal_id : "",
    cover_message,
    questions,
    document_requests: documentRequests,
    assembled_at: new Date().toISOString(),
  };
}
