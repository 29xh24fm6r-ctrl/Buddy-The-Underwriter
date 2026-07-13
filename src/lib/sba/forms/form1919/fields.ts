/**
 * SBA Form 1919 — Borrower Information Form. Full fielding per SOP 50 10 8
 * (current revision dated June 2025). Three sections:
 *   I   — applicant business (one per deal)
 *   II  — per individual subject to disclosure (every 20%+ owner, officer,
 *         GP, day-to-day manager, trustor)
 *   III — per equity-owning entity
 *
 * pdfCoord is a rendering hint only — best-effort, refined by banker QA
 * once the official PDF template exists (ARC-00 Phase 0.C is currently
 * blocked on network access to sba.gov; no coordinates have been mapped
 * against a real template yet, so this field omits pdfCoord entirely
 * rather than guess at placement). The contract that matters is
 * key + label + section + required.
 */

export type Form1919Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_1919_SECTION_I_FIELDS: Form1919Field[] = [
  { key: "applicant_legal_name", label: "Applicant legal name", required: true },
  { key: "applicant_dba", label: "Doing business as (DBA)", required: false },
  { key: "applicant_ein", label: "Employer Identification Number (EIN)", required: true },
  { key: "applicant_address_street", label: "Business address — street", required: true },
  { key: "applicant_address_city", label: "Business address — city", required: true },
  { key: "applicant_address_state", label: "Business address — state", required: true },
  { key: "applicant_address_zip", label: "Business address — ZIP", required: true },
  { key: "applicant_phone", label: "Business phone", required: true },
  { key: "applicant_business_type", label: "Type of business", required: true },
  { key: "applicant_naics", label: "NAICS code", required: true },
  { key: "applicant_employee_count", label: "Number of employees", required: true },
  { key: "applicant_year_founded", label: "Year business founded", required: true },
  { key: "loan_amount", label: "Loan amount requested", required: true },
  { key: "loan_program", label: "SBA loan program", required: true },
  { key: "use_of_proceeds_summary", label: "Use of proceeds summary", required: true },
  { key: "is_franchise_deal", label: "Is this a franchise?", required: true },
  { key: "franchise_identifier_code", label: "Franchise identifier code", required: false },
  { key: "franchise_brand_name", label: "Franchise brand name", required: false },
  { key: "has_other_sba_application_pending", label: "Other SBA application pending?", required: true },
  { key: "has_been_in_bankruptcy_pending", label: "Bankruptcy pending?", required: true },
  { key: "has_pending_lawsuits", label: "Pending lawsuits?", required: true },
  { key: "is_engaged_in_lobbying", label: "Engaged in lobbying activities?", required: true },
];

export const FORM_1919_SECTION_II_FIELDS: Form1919Field[] = [
  { key: "full_name", label: "Full legal name", required: true },
  { key: "ssn_last4", label: "SSN — last 4", required: true },
  { key: "date_of_birth", label: "Date of birth", required: true },
  { key: "place_of_birth", label: "Place of birth", required: true },
  { key: "is_us_citizen", label: "U.S. citizen?", required: true },
  { key: "is_us_national", label: "U.S. national?", required: true },
  { key: "is_lpr", label: "Lawful permanent resident?", required: true },
  { key: "alien_registration_number", label: "Alien registration number", required: false },
  { key: "home_address_street", label: "Home address — street", required: true },
  { key: "home_address_city", label: "Home address — city", required: true },
  { key: "home_address_state", label: "Home address — state", required: true },
  { key: "home_address_zip", label: "Home address — ZIP", required: true },
  { key: "is_employee_of_us_government", label: "Employee of U.S. government?", required: true },
  { key: "has_other_government_employment", label: "Other government employment?", required: true },
  { key: "has_been_arrested_or_charged_in_6mo", label: "Arrested/charged in last 6 months?", required: true },
  { key: "has_been_convicted_or_pleaded", label: "Convicted or pleaded guilty/nolo?", required: true },
  { key: "has_pending_criminal_charges", label: "Pending criminal charges?", required: true },
  { key: "is_subject_to_indictment", label: "Subject to indictment?", required: true },
  { key: "has_paroled_or_probation", label: "On parole or probation?", required: true },
];

/** Any of these true on a Section II person triggers Form 912. */
export const FORM_912_TRIGGER_FIELDS: readonly string[] = [
  "has_been_arrested_or_charged_in_6mo",
  "has_been_convicted_or_pleaded",
  "has_pending_criminal_charges",
  "is_subject_to_indictment",
  "has_paroled_or_probation",
];

export const FORM_1919_SECTION_III_FIELDS: Form1919Field[] = [
  { key: "legal_name", label: "Entity legal name", required: true },
  { key: "ein", label: "Entity EIN", required: true },
  { key: "entity_type", label: "Entity type", required: true },
  { key: "address_street", label: "Entity address — street", required: true },
  { key: "address_city", label: "Entity address — city", required: true },
  { key: "address_state", label: "Entity address — state", required: true },
  { key: "address_zip", label: "Entity address — ZIP", required: true },
];

export function missingRequiredFields(fields: Form1919Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
