/**
 * SBA Note — the promissory note the borrower signs at closing. Unlike the
 * 11 forms in sibling directories (1919, 413, 912, ...), there is no single
 * official fillable PDF to fill: SBA lets each lender use its own note
 * (SBA Form 147 is a standard/reference note, but not the only one banks
 * use). Buddy drafts this document from standard SBA Note structure —
 * see render.ts — rather than filling a template.
 *
 * Content basis: well-established, publicly-documented SBA Note structure
 * (promise-to-pay, interest computation, payment terms, late charge,
 * default/acceleration, SBA guaranty reference). This is NOT a substitute
 * for attorney review — see src/lib/sba/legalReview/service.ts, which
 * gates every send-for-signature on an explicit review approval.
 */

export type SbaNoteField = {
  key: string;
  label: string;
  required: boolean;
};

export const SBA_NOTE_FIELDS: SbaNoteField[] = [
  { key: "borrower_legal_name", label: "Borrower legal name", required: true },
  { key: "lender_name", label: "Lender name", required: true },
  { key: "principal_amount", label: "Principal amount", required: true },
  { key: "interest_rate_pct", label: "Interest rate", required: true },
  { key: "rate_type", label: "Rate type (fixed/variable)", required: true },
  { key: "term_months", label: "Loan term (months)", required: true },
  { key: "payment_frequency", label: "Payment frequency", required: true },
  { key: "use_of_proceeds_summary", label: "Use of proceeds", required: true },
];

export function missingRequiredFields(fields: SbaNoteField[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}

/**
 * SBA-standard late-charge clause, used when the deal has no banker
 * override (deal_loan_requests.late_charge_override_text). Matches the
 * long-standing SBA-published standard: the greater of 5% of the unpaid
 * portion of the payment or $100, capped at the amount of one payment,
 * charged once per late payment no earlier than 10 days after the due date.
 */
export function standardLateChargeText(): string {
  return (
    "If a payment on this Note is more than 10 days late, Lender may charge Borrower a late fee " +
    "of up to 5% of the unpaid portion of the regularly scheduled payment, or $100.00, whichever " +
    "is greater, not to exceed the amount of one payment."
  );
}

/**
 * SBA-standard prepayment-penalty clause. SBA only imposes a prepayment
 * penalty on 7(a) loans with a maturity of 15 years or more, voluntarily
 * prepaid (more than 25% of the outstanding balance) within the first
 * three years after disbursement, on a declining schedule: 5% (year 1),
 * 3% (year 2), 1% (year 3), 0% thereafter. Loans under 15 years carry no
 * SBA prepayment penalty.
 */
export function standardPrepaymentPenaltyText(termMonths: number | null): string {
  if (termMonths == null) {
    return "Prepayment penalty terms depend on the final loan term and have not yet been determined.";
  }
  if (termMonths < 180) {
    return "Borrower may prepay this Note in whole or in part at any time without penalty.";
  }
  return (
    "If Borrower voluntarily prepays more than 25% of the outstanding principal balance within the " +
    "first three years after the date of first disbursement, Borrower must pay Lender a prepayment " +
    "premium equal to: 5% of the amount prepaid if prepaid within the first year; 3% if prepaid " +
    "within the second year; and 1% if prepaid within the third year. No prepayment premium applies " +
    "after the third year or to prepayments of 25% or less of the outstanding principal balance in " +
    "any given year."
  );
}
