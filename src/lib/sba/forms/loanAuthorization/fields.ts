/**
 * Loan Authorization & Agreement — the document that governs the loan's
 * terms, conditions precedent to disbursement, covenants, and default
 * provisions. Like the Note (sbaNote/), there is no single official
 * fillable PDF: SBA prepares/approves the Authorization, but its content
 * is lender/deal-specific. Buddy drafts it from standard SBA Authorization
 * structure — see render.ts. Same caveat as sbaNote/fields.ts: this is a
 * draft for attorney review, not a substitute for it — see
 * src/lib/sba/legalReview/service.ts.
 */

export type LoanAuthorizationField = {
  key: string;
  label: string;
  required: boolean;
};

export const LOAN_AUTHORIZATION_FIELDS: LoanAuthorizationField[] = [
  { key: "borrower_legal_name", label: "Borrower legal name", required: true },
  { key: "lender_name", label: "Lender name", required: true },
  { key: "principal_amount", label: "Principal amount", required: true },
  { key: "interest_rate_pct", label: "Interest rate", required: true },
  { key: "term_months", label: "Loan term (months)", required: true },
  { key: "use_of_proceeds_summary", label: "Use of proceeds", required: true },
];

export function missingRequiredFields(fields: LoanAuthorizationField[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}

/** Standard SBA conditions precedent to first disbursement. */
export const STANDARD_CONDITIONS_PRECEDENT: string[] = [
  "Evidence that all required equity injection has been made and verified in accordance with SBA requirements.",
  "Execution and delivery of the Note, all guaranty agreements, and all security instruments required for this loan.",
  "Evidence of hazard, liability, and (if applicable) flood insurance on any collateral, naming Lender as loss payee/mortgagee as its interest may appear.",
  "Evidence of all required business licenses, permits, and good standing certifications.",
  "Payment of all fees required in connection with this loan, including the SBA guaranty fee.",
  "No material adverse change in Borrower's financial condition, organization, management, or operations since the date of loan approval.",
];

/** Standard SBA affirmative covenants not otherwise captured in deal_covenants. */
export const STANDARD_AFFIRMATIVE_COVENANTS: string[] = [
  "Maintain hazard and liability insurance on all collateral in amounts and with insurers satisfactory to Lender.",
  "Pay all taxes, assessments, and government charges when due.",
  "Maintain books and records in accordance with generally accepted accounting practices and permit Lender to inspect them on reasonable notice.",
  "Notify Lender promptly of any material adverse change in Borrower's business, financial condition, or organization.",
];

/** Standard SBA negative covenants. */
export const STANDARD_NEGATIVE_COVENANTS: string[] = [
  "Borrower will not, without Lender's prior written consent, incur additional debt secured by any collateral for this loan, other than trade debt incurred in the ordinary course of business.",
  "Borrower will not change its ownership structure, legal form of organization, or effect a merger, consolidation, or sale of substantially all of its assets, without Lender's prior written consent.",
  "Borrower will not make distributions or dividends to owners while any payment under this loan is more than 30 days past due, or if doing so would cause a default under this Authorization.",
  "Borrower will not pledge any collateral for this loan to secure any other obligation without Lender's prior written consent.",
];

/** Standard SBA conditions subsequent (post-closing). */
export const STANDARD_CONDITIONS_SUBSEQUENT: string[] = [
  "Borrower will provide annual financial statements and, if required, annual business tax returns within the timeframe specified by Lender.",
  "Borrower will maintain the collateral in good repair and promptly notify Lender of any loss or damage.",
  "Borrower will use loan proceeds solely for the purposes described in this Authorization and provide documentation of use of proceeds upon Lender's request.",
];
