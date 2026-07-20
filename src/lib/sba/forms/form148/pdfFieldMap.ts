/**
 * Real AcroForm field names for SBA Form 148 (Unconditional Guarantee,
 * 10/98) and Form 148L (Unconditional Limited Guarantee, 06/25),
 * confirmed against user-supplied copies of both current PDFs
 * (docs/sba-forms/148-fields.json, 148l-fields.json). Two entirely
 * different field-name sets (148 uses "Guarantor"/"NoteAmount" etc, 148L
 * uses lowerCamelCase "guarantor"/"noteAmount") for the same underlying
 * semantic keys — render.ts picks the map matching the signer's
 * guaranteeType.
 *
 * Both forms leave the actual signature/execution-date fields blank for
 * SignWell (never pre-filled with a guessed date), same convention as
 * every other form in this arc. 148's "SignatureBlock" is a single
 * combined name+signature free-text box spanning the whole page —
 * deliberately left untouched rather than risk visual collision with
 * SignWell's own signature overlay. 148L's guarantorSignature1-10 are
 * native PDFSignature fields (not plain text) and are never written to.
 * Both forms' "state-specific provisions" box has no data source
 * anywhere (attorney/bank-supplied boilerplate) and is left blank.
 */

export const FORM_148_TEXT_FIELDS = {
  sba_loan_number: "LoanNumber",
  sba_loan_name: "LoanName",
  guarantor_name: "Guarantor",
  borrower_legal_name: "Borrower",
  lender_name: "Lender",
  loan_amount: "NoteAmount",
  loan_amount_words: "NoteAmountSO",
  agreement_date: "Date",
  note_date: "NoteDate",
} as const;

export const FORM_148L_TEXT_FIELDS = {
  sba_loan_number: "loanNum",
  sba_loan_name: "loanName",
  guarantor_name: "guarantor",
  borrower_legal_name: "borrower",
  lender_name: "lender",
  loan_amount: "noteAmount",
  loan_amount_words: "principalAmount",
  note_date: "noteDate",
  limit_balance_under: "limitBalanceUnder",
  limit_principal_under: "limitPrincipalUnder",
  limit_max_payment: "limitMaxPayment",
  limit_percent_payment: "limitPercentPayment",
  limit_time_years: "limitTimeYears",
  limit_collateral_description: "limitCollateralSpecify",
  guarantor_name_1: "guarantorName1",
} as const;

export const FORM_148L_CHECKBOX_FIELDS = {
  limit_balance_reduction: "limitBalanceReduction",
  limit_max_liability: "limitMaxLiability",
  limit_principal_reduction: "limitPrincipalReduction",
  limit_percentage: "limitPercentage",
  limit_time: "limitTime",
  limit_collateral: "limitCollateral",
  limit_community: "limitCommunity",
} as const;

/** ownership_entities.guarantee_limitation_type -> which 148L checkbox to check. */
export const GUARANTEE_LIMITATION_CHECKBOX: Record<string, keyof typeof FORM_148L_CHECKBOX_FIELDS> = {
  balance_reduction: "limit_balance_reduction",
  max_liability: "limit_max_liability",
  principal_reduction: "limit_principal_reduction",
  percentage: "limit_percentage",
  time_based: "limit_time",
  collateral: "limit_collateral",
  community_property: "limit_community",
};
