/**
 * SBA Form 155 — Standby Creditor's Agreement. Conditional (SPEC S4 G-3):
 * only required when `seller_note_equity_portion > 0` on
 * deal_loan_requests. Two signers — borrower and the standby creditor
 * (the seller) — both gated on IAL2 + e-sign per S3, same as every other
 * form in this arc.
 */

export type Form155Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_155_FIELDS: Form155Field[] = [
  { key: "borrower_legal_name", label: "Borrower legal name", required: true },
  { key: "lender_name", label: "Lender name", required: true },
  { key: "loan_amount", label: "SBA loan amount", required: true },
  { key: "standby_creditor_name", label: "Standby creditor (seller) name", required: true },
  { key: "standby_creditor_address", label: "Standby creditor address", required: true },
  { key: "note_principal_amount", label: "Standby note principal amount", required: true },
  { key: "note_date", label: "Standby note date", required: true },
  { key: "note_interest_rate", label: "Standby note interest rate", required: false },
  { key: "full_standby_for_loan_term", label: "Full standby for entire SBA loan term?", required: true },
  { key: "subordination_terms_acknowledged", label: "Subordination terms acknowledged", required: true },
];

export function missingRequiredFields(fields: Form155Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
