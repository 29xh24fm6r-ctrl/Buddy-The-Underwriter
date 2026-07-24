/**
 * SBA Form 1244 (12/2021) — Application for Section 504 Loans.
 *
 * Rewritten against a real copy of the current PDF (see
 * pdfFieldMap.ts). Two significant structural findings versus the old
 * model:
 *
 * 1. Section One is a dual-entity (EPC + Operating Company) structure —
 *    modeled with zero representation before. Several old "Section I"
 *    fields (total_project_cost/third_party_lender_amount/
 *    cdc_debenture_amount/borrower_contribution_amount/
 *    occupancy_percentage/franchise_identifier_code/franchise_brand_name)
 *    turned out not to be on the Applicant-facing sections at all — the
 *    sources-and-uses table and franchise-directory lookup are in
 *    Section Four ("Completed by the CDC," pages 12-20 of the real PDF),
 *    the CDC's own back-office paperwork, not this form module's
 *    concern. Dropped from the required set (underlying deal_loan_requests
 *    columns are untouched — other consumers, e.g. underwriting output,
 *    may still use them).
 * 2. Section Two's real personal-history question set is 5 yes/no
 *    questions specific to this form, not the 13 borrowed from Form
 *    1919 the old code assumed (a different SBA program with a
 *    different, richer set) — see form1244/pdfFieldMap.ts for the
 *    verified mapping (including a stale-tooltip bug resolved by widget
 *    position, same discipline as Form 1919's Q5/Q6 finding).
 *
 * Section Four (CDC) and the true Section Three (a signature/attestation
 * block, not additional data fields) are not "Section III" data-fields
 * the old model assumed either — see build.ts/render.ts.
 */

export type Form1244Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_1244_SECTION_I_FIELDS: Form1244Field[] = [
  { key: "applicant_legal_name", label: "Applicant (EPC, if applicable) legal name", required: true },
  { key: "applicant_address", label: "Applicant business address", required: true },
  { key: "applicant_dba", label: "Doing business as (DBA)", required: false },
  { key: "applicant_legal_structure", label: "Applicant legal structure", required: true },
  { key: "applicant_tax_id", label: "Applicant Tax ID", required: true },
  { key: "applicant_duns_number", label: "Applicant DUNS number", required: false },
  { key: "applicant_contact_name", label: "Applicant contact name", required: true },
  { key: "applicant_email", label: "Applicant email address", required: true },
  { key: "applicant_phone", label: "Applicant phone", required: true },
  { key: "applicant_website", label: "Applicant business web address", required: false },
  // Only required when isEligiblePassiveCompany — enforced in build.ts.
  { key: "oc_legal_name", label: "Operating Company legal name", required: false },
  { key: "oc_address", label: "Operating Company business address", required: false },
  { key: "oc_dba", label: "Operating Company DBA", required: false },
  { key: "oc_legal_structure", label: "Operating Company legal structure", required: false },
  { key: "oc_tax_id", label: "Operating Company Tax ID", required: false },
  { key: "oc_duns_number", label: "Operating Company DUNS number", required: false },
  { key: "oc_contact_name", label: "Operating Company contact name", required: false },
  { key: "oc_email", label: "Operating Company email address", required: false },
  { key: "oc_phone", label: "Operating Company phone", required: false },
  { key: "oc_website", label: "Operating Company web address", required: false },
  { key: "type_of_business", label: "Type of business (summary description)", required: true },
  { key: "existing_employee_count", label: "# of existing employees", required: true },
  { key: "jobs_to_be_created", label: "# of jobs to be created in next 2 years", required: false },
  { key: "jobs_to_be_retained", label: "# of jobs to be retained in next 2 years", required: false },
  { key: "loan_amount_required", label: "Loan amount required", required: true },
  { key: "loan_purpose", label: "Purpose of the loan", required: true },
  { key: "has_affiliates", label: "Does the Applicant have any affiliates?", required: true },
  { key: "obtained_direct_or_guaranteed_loan", label: "Ever obtained/applied for a direct or guaranteed government loan?", required: true },
  { key: "prior_application_submitted", label: "Application for this project previously submitted to SBA?", required: true },
  { key: "ever_bankrupt", label: "Has the Applicant business ever declared bankruptcy?", required: true },
  { key: "pending_lawsuits", label: "Is the Applicant business involved in any pending lawsuits?", required: true },
];

/** Section Two — per-Associate personal history. Real 5 questions (see pdfFieldMap.ts), not the 13 borrowed from Form 1919. */
export const FORM_1244_SECTION_II_FIELDS: Form1244Field[] = [
  { key: "full_name", label: "Full legal name", required: true },
  { key: "is_us_citizen", label: "U.S. citizen?", required: true },
  { key: "place_of_birth", label: "Place of birth", required: true },
  { key: "date_of_birth", label: "Date of birth", required: true },
  { key: "full_ssn", label: "SSN or IRS TIN", required: true },
  { key: "phone", label: "Phone (home or cell)", required: true },
  { key: "home_address", label: "Home address", required: true },
  { key: "sba_loan_entity_interest", label: "Ownership interest in another entity with existing SBA loans?", required: true },
  { key: "subject_to_indictment", label: "Presently subject to indictment/criminal information/arraignment?", required: true },
  { key: "arrested_6mo", label: "Arrested in the last 6 months for any criminal offense?", required: true },
  { key: "convicted_diversion_or_parole", label: "Ever convicted/pleaded guilty/nolo/pretrial diversion/parole for a criminal offense?", required: true },
  { key: "suspended_debarred_ineligible", label: "Presently suspended/debarred/ineligible/excluded from federal participation?", required: true },
];

/** Form 912 is triggered by any of the 3 compliance-risk questions — same "ask 912 to elaborate" policy as Form 1919. */
export const FORM_912_TRIGGER_FIELDS = ["subject_to_indictment", "convicted_diversion_or_parole", "suspended_debarred_ineligible"];

export function missingRequiredFields(fields: Form1244Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
