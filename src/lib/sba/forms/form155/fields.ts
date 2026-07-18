/**
 * SBA Form 155 — Standby Creditor's Agreement. Conditional (SPEC S4 G-3):
 * only required when `seller_note_equity_portion > 0` on
 * deal_loan_requests. Two signers — borrower and the standby creditor
 * (the seller) — both gated on IAL2 + e-sign per S3, same as every other
 * form in this arc.
 *
 * Rewritten against the real current-revision PDF (see pdfFieldMap.ts):
 * the real form's only substantive decision is which of 4 numbered
 * payment-deferral options the standby creditor agrees to
 * (`agree_option`) — `full_standby_for_loan_term` (boolean) and a
 * free-standing `subordination_terms_acknowledged` checkbox don't exist
 * as distinct fields on this revision, so they're dropped from the
 * form's own required set (the underlying DB columns are untouched —
 * see the migration's comment for who else still uses them).
 */

export type Form155Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_155_FIELDS: Form155Field[] = [
  { key: "sba_loan_number", label: "SBA loan number", required: true },
  { key: "sba_loan_name", label: "SBA loan name", required: true },
  { key: "standby_borrower_name", label: "Standby borrower (the SBA applicant) name", required: true },
  { key: "standby_creditor_name", label: "Standby creditor (seller) name", required: true },
  { key: "lender_name", label: "Lender name", required: true },
  { key: "note_principal_amount", label: "Standby note principal owed as of this agreement", required: true },
  { key: "note_interest_amount", label: "Standby note interest owed as of this agreement", required: true },
  { key: "lenders_loan_amount", label: "SBA-guaranteed lender's loan amount", required: true },
  { key: "agree_option", label: "Which payment arrangement the standby creditor agrees to (1-4)", required: true },
  { key: "agree_option_2_rate", label: "Option 2 — interest-only rate (% per annum)", required: false },
  { key: "agree_option_3_rate", label: "Option 3 — principal & interest rate (% per annum)", required: false },
  { key: "agree_option_4_rate", label: "Option 4 — principal & interest rate (% per annum)", required: false },
  { key: "agree_option_4_start_date", label: "Option 4 — date payments begin", required: false },
];

export function missingRequiredFields(fields: Form155Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
