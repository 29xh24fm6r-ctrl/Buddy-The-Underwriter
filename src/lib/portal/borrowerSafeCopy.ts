export const APPROVED_BORROWER_LABELS = {
  PERSONAL_FINANCIAL_STATEMENT: "Personal Financial Statement",
  BUSINESS_TAX_RETURN: "Business Tax Returns",
  VOIDED_CHECK: "Voided Business Check",
} as const;

export const APPROVED_BORROWER_PROGRESS_STAGES = [
  "Getting started",
  "Documents requested",
  "Documents received",
  "Buddy reviewing your package",
  "Additional items needed",
  "Ready for SBA review",
] as const;

export const FORBIDDEN_BORROWER_TERMS = [
  "readiness_regressed",
  "docs_in_progress",
  "underwriting_score",
  "trident_failure",
  "OCR confidence",
  "lender_match_status",
  "retry_exhausted",
  "provider failure",
  "comms_outbox",
  "retry queue",
  "banker notes",
  "lifecycle enum",
  "readiness score",
  "credit score",
  "underwriting prediction",
] as const;

export const FORBIDDEN_INTERNAL_ENUMS = [
  "waiting_for_checklist",
  "uploading_docs",
  "bank_review",
  "uw",
  "approval",
  "closing",
] as const;

export function detectForbiddenBorrowerTerminology(input: string) {
  const haystack = input.toLowerCase();
  return FORBIDDEN_BORROWER_TERMS.filter((term) =>
    haystack.includes(term.toLowerCase()),
  );
}

export function detectForbiddenInternalEnums(input: string) {
  const haystack = input.toLowerCase();
  return FORBIDDEN_INTERNAL_ENUMS.filter((term) =>
    haystack.includes(term.toLowerCase()),
  );
}

export function detectSignedUrlExposure(input: string) {
  const patterns = [
    /signed url/i,
    /https?:\/\/[^\s"'`]+/i,
    /storage/i,
    /provider failure/i,
    /parser failure/i,
  ];

  return patterns.some((pattern) => pattern.test(input));
}

export function detectRawDocCodeExposure(input: string) {
  return /\b[A-Z0-9]+(?:_[A-Z0-9]+){1,}\b/.test(input);
}
