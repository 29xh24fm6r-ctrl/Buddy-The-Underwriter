/**
 * Real AcroForm field names for SBA Form 155 — Standby Creditor's
 * Agreement (9/98 revision), confirmed against a user-supplied copy of
 * the current PDF (docs/sba-forms/155-fields.json) and cross-checked by
 * visually rendering a fill-test (see render.ts's header comment). Only
 * 16 fields total — the smallest of the forms in this arc.
 *
 * "Agree" is a PDFRadioGroup with options "1"-"4", one per numbered
 * payment-deferral arrangement the standby creditor can choose (see the
 * rendered PDF: item 1 has 4 sub-bullets, each a distinct option — items
 * 2-8 are boilerplate with no fields). Options 2/3/4 each have their own
 * rate sub-field; option 4 additionally has a start-date sub-field.
 *
 * "StandbyCreditor"/"StandbyBorrower"/"Lender"/"LoanNumber" each have 2-3
 * widgets across the header table + inline paragraph + (StandbyCreditor
 * only) the page-2 signature block — one pdf-lib field, multiple widget
 * rects, filled once.
 *
 * "SignatureName" is the printed name on the "(name)" line; "SignatureNamex"
 * is the actual "(signature)" line and "Date" is the "Dated:" line — both
 * left for SignWell to fill at signing, same as every other form in this
 * arc (never pre-filled with a guessed signature date).
 */

export const FORM_155_TEXT_FIELDS = {
  sba_loan_number: "LoanNumber",
  sba_loan_name: "LoanName",
  standby_creditor_name: "StandbyCreditor",
  standby_borrower_name: "StandbyBorrower",
  lender_name: "Lender",
  note_principal_amount: "PrincipalAmount",
  note_interest_amount: "InterestAmount",
  lenders_loan_amount: "LenderLoan",
  agree_option_2_rate: "Agree2Percent",
  agree_option_3_rate: "Agree3Percent",
  agree_option_4_rate: "Agree4Percent",
  agree_option_4_start_date: "Agree4Date",
  print_name: "SignatureName",
} as const;

export const FORM_155_RADIO_FIELDS = {
  agree_option: { fieldName: "Agree", options: ["1", "2", "3", "4"] as const },
} as const;
