import { QUALITY_THRESHOLDS } from "@/lib/intake/quality/evaluateDocumentQuality";
import { YEAR_REQUIRED_TYPES } from "@/lib/intake/confirmation/computeDocBlockers";

export const BORROWER_DOCUMENT_TYPES = [
  ["BUSINESS_TAX_RETURN", "Business tax return"],
  ["PERSONAL_TAX_RETURN", "Personal tax return"],
  ["BALANCE_SHEET", "Balance sheet"],
  ["INCOME_STATEMENT", "Profit and loss statement"],
  ["PFS", "Personal financial statement"],
  ["BANK_STATEMENT", "Bank statement"],
  ["COMMERCIAL_LEASE", "Lease"],
  ["OTHER", "Other supporting document"],
] as const;

export function isSelfServeOrigin(origin: unknown): boolean {
  return origin === "brokerage_anonymous" || origin === "brokerage_claimed";
}

export function isBorrowerCollectionPhase(phase: unknown): boolean {
  return phase === "BULK_UPLOADED" || phase === "CLASSIFIED_PENDING_CONFIRMATION";
}

export type AdmissionDocument = {
  status?: string | null;
  source: string | null;
  is_active: boolean | null;
  intake_status: string | null;
  quality_status: string | null;
  canonical_type: string | null;
  doc_year: number | null;
  segmented: boolean | null;
  ocr_text_length: number | null;
  logical_key: string | null;
  gatekeeper_needs_review: boolean | null;
  gatekeeper_route: string | null;
};

/** Admission to extraction is not package certification or lender acceptance. */
export function borrowerDocumentAdmission(doc: AdmissionDocument): string | null {
  if (doc.is_active !== true || doc.status === "withdrawn") return "inactive";
  if (!["borrower", "borrower_portal"].includes(doc.source ?? "")) return "not_borrower_upload";
  if (doc.segmented) return "split_document";
  if ((doc.ocr_text_length ?? 0) < QUALITY_THRESHOLDS.MIN_TEXT_LENGTH ||
      ["FAILED_OCR_ERROR", "FAILED_LOW_TEXT"].includes(doc.quality_status ?? "")) return "clearer_copy";
  if (doc.quality_status !== "PASSED") return "document_details";
  if (!doc.canonical_type || !["AUTO_CONFIRMED", "USER_CONFIRMED"].includes(doc.intake_status ?? "")) return "document_details";
  if (YEAR_REQUIRED_TYPES.has(doc.canonical_type) && !doc.doc_year) return "tax_year";
  if (["PERSONAL_TAX_RETURN", "BUSINESS_TAX_RETURN", "PFS", "PERSONAL_FINANCIAL_STATEMENT"].includes(doc.canonical_type) && !doc.logical_key) return "document_owner";
  if (doc.gatekeeper_needs_review || doc.gatekeeper_route === "NEEDS_REVIEW") return "document_details";
  return null;
}

export const DOCUMENT_ACTION_TEXT: Record<string, string> = {
  clearer_copy: "Please upload a complete, readable copy. Buddy could not read enough of this file.",
  split_document: "Please upload each separate document as its own file so Buddy can identify it correctly.",
  document_details: "Buddy needs one detail: what kind of document is this?",
  tax_year: "Which tax year does this return cover?",
  document_owner: "Please provide a copy that clearly identifies the person or business this document belongs to.",
  inactive: "This document has been replaced or withdrawn.",
  not_borrower_upload: "This document was supplied separately from your uploads.",
};
