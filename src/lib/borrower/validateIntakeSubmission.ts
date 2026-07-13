// src/lib/borrower/validateIntakeSubmission.ts
//
// Pure gate for the intake wizard's final "submit" step. Previously the
// route only checked business_legal_name was non-empty, so a borrower could
// click through every other step blank and successfully submit — the
// banker would have to catch a mostly-empty application manually, after the
// borrower had already seen the reassuring "Application Submitted" screen.
// Extracted from the API route so this logic is unit-testable without
// mocking Supabase.

export type IntakeSubmissionInputs = {
  app: { business_legal_name: string | null; loan_type: string | null; loan_amount: number | null } | null;
  addressCompleted: boolean;
  ownerCount: number;
  isSbaLoanType: boolean;
  complianceCompleted: boolean;
};

/** Returns a borrower-facing error string, or null if the application is ready to submit. */
export function validateIntakeSubmission(input: IntakeSubmissionInputs): string | null {
  const { app, addressCompleted, ownerCount, isSbaLoanType, complianceCompleted } = input;

  if (!app) return "No application found. Please complete all steps first.";
  if (!app.business_legal_name) return "Business legal name is required.";
  if (!app.loan_type) return "Please select a loan type before submitting.";
  if (!app.loan_amount || app.loan_amount <= 0) return "Please enter the loan amount you're requesting.";
  if (!addressCompleted) return "Please complete your business address before submitting.";
  if (ownerCount <= 0) return "Please add at least one business owner before submitting.";
  if (isSbaLoanType && !complianceCompleted) {
    return "Please answer the SBA compliance questions before submitting.";
  }
  return null;
}
