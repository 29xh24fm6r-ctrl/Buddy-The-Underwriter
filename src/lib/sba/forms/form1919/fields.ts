/**
 * SBA Form 1919 — Borrower Information Form.
 *
 * Field set rewritten against the real, current-revision PDF (see
 * docs/sba-forms/1919-fields.json, dumped from a user-supplied copy —
 * sba.gov is blocked in this environment). Real structure, confirmed via
 * each field's own /TU tooltip and page position:
 *
 *   Section I  — applicant business, identical on every individual's
 *                copy of the form (page 1 of the real PDF).
 *   Section II — completed PER COVERED INDIVIDUAL (page 2-3): position,
 *                demographics/veteran status, all 13 real yes/no
 *                compliance questions, and (surprisingly, but confirmed
 *                by field position) the export-sales sub-section.
 *   Section III — per equity-owning entity, unchanged from the prior
 *                version — no evidence this part was wrong, only that
 *                the field *names* need mapping (see pdfFieldMap.ts).
 *
 * This is a correction, not just a naming fix: the prior version modeled
 * Section II's 13 questions as 4 much broader ones
 * (has_other_sba_application_pending / has_been_in_bankruptcy_pending /
 * has_pending_lawsuits / is_engaged_in_lobbying) and rendered Section II
 * once per deal instead of once per individual. See
 * docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md.
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
  { key: "unique_entity_id", label: "SAM.gov Unique Entity ID (UEI)", required: false },
  { key: "applicant_address_street", label: "Business address — street", required: true },
  { key: "applicant_address_city", label: "Business address — city", required: true },
  { key: "applicant_address_state", label: "Business address — state", required: true },
  { key: "applicant_address_zip", label: "Business address — ZIP", required: true },
  { key: "project_address_street", label: "Project address, if different from business address", required: false },
  { key: "applicant_phone", label: "Business phone", required: true },
  { key: "applicant_business_type", label: "Type of business", required: true },
  { key: "special_ownership_type", label: "Special ownership type (ESOP/401(k)/Cooperative/Native-American Tribal/Other)", required: false },
  { key: "applicant_naics", label: "NAICS code", required: true },
  { key: "applicant_employee_count", label: "Number of existing employees", required: true },
  { key: "applicant_year_founded", label: "Year business began operations", required: true },
  { key: "poc_name", label: "Primary point of contact — name", required: true },
  { key: "poc_email", label: "Primary point of contact — email", required: true },
  { key: "loan_amount", label: "Loan amount requested", required: true },
  { key: "loan_program", label: "SBA loan program", required: true },
  { key: "jobs_retained", label: "FTE jobs retained/saved because of the loan", required: false },
  { key: "jobs_created", label: "FTE jobs created in the next two years because of the loan", required: false },
  { key: "is_franchise_deal", label: "Is this a franchise?", required: true },
  { key: "franchise_identifier_code", label: "Franchise identifier code", required: false },
  { key: "franchise_brand_name", label: "Franchise brand name", required: false },
];

export const FORM_1919_SECTION_II_FIELDS: Form1919Field[] = [
  { key: "full_name", label: "Full legal name", required: true },
  { key: "position", label: "Position/title with the Applicant", required: true },
  { key: "full_ssn", label: "Social Security Number", required: true },
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
  { key: "veteran_status", label: "Veteran status", required: false },
  { key: "sex", label: "Sex", required: false },
  { key: "race", label: "Race", required: false },
  { key: "ethnicity", label: "Ethnicity", required: false },
  // The 13 real yes/no questions.
  { key: "debarred_ineligible_or_bankrupt", label: "Debarred, ineligible, or presently involved in bankruptcy? (Q1)", required: true },
  { key: "defaulted_or_delinquent_gov_loan", label: "Delinquent or defaulted on a direct/guaranteed government loan? (Q2)", required: true },
  { key: "owns_other_business", label: "Applicant or any owner is an owner of another business? (Q3)", required: true },
  { key: "incarcerated_or_indicted_financial_crime", label: "Incarcerated or under indictment for a felony or financial-misconduct/false-statement crime? (Q4)", required: true },
  // Q5 is the export gate, not a fee question — confirmed by a visual
  // fill-test (the field q5Yes/q5No's own /TU tooltip is stale/wrong on
  // the real PDF; page position and the rendered output both confirm
  // this). There's no separate CDC-fee question on this (7(a)) revision
  // at all — 504 loans use the separate SBA Form 1244.
  { key: "has_export_sales", label: "Are any products/services exported, or is this an EWCP loan? (Q5)", required: true },
  { key: "fee_paid_to_lender_or_broker", label: "Fee paid/committed to the Lender or a broker to assist with this application? (Q6)", required: true },
  { key: "restricted_revenue_source", label: "Revenue from gambling, lending, lobbying, or prurient content/services? (Q7)", required: true },
  { key: "sba_employee_conflict", label: "10%+ owner/officer/director is an SBA employee or household member of one? (Q8)", required: true },
  { key: "former_sba_employee_conflict", label: "Associated with a former SBA employee separated less than 1 year? (Q9)", required: true },
  { key: "congress_legislative_judicial_conflict", label: "10%+ owner/officer/director or household member is a member of Congress or legislative/judicial branch official? (Q10)", required: true },
  { key: "federal_employee_or_military_conflict", label: "10%+ owner/officer/director or household member is a GS-13+ federal employee or military equivalent? (Q11)", required: true },
  { key: "score_or_advisory_council_member", label: "10%+ owner/officer/director or household member is a SCORE volunteer or Small Business Advisory Council member? (Q12)", required: true },
  { key: "legal_action_pending", label: "Applicant, any owner, or an affiliate presently involved in legal action (including divorce)? (Q13)", required: true },
  // Export-sales sub-section — confirmed by page position to sit inside
  // Section II, not Section I, despite being deal/business-level in
  // substance.
  { key: "export_sales_total", label: "Estimated total export sales this loan will support", required: false },
  { key: "export_country_1", label: "Principal export country #1", required: false },
  { key: "export_country_2", label: "Principal export country #2", required: false },
  { key: "export_country_3", label: "Principal export country #3", required: false },
];

/** Any of these true on a Section II person triggers Form 912. Q4's
 * disclosure is the same one 912 asks as its own Q8 — see
 * ownership_entities.incarcerated_or_indicted_financial_crime. */
export const FORM_912_TRIGGER_FIELDS: readonly string[] = ["incarcerated_or_indicted_financial_crime"];

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
