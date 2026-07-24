/**
 * Real AcroForm field names for SBA Form 1244 (12/2021) — Application for
 * Section 504 Loans, confirmed against a user-supplied copy of the
 * current PDF (docs/sba-forms/1244-fields.json). 370 fields across 20
 * pages — verified scope is Sections One-Three (the Applicant's own
 * fill responsibility); Section Four ("Completed by the CDC", pages
 * 12-20 — CDC contact info, TPL/interim-lender info, size-standard/
 * urban-rural/debt-refinancing determinations, sources-and-uses,
 * exhibit checklist) is the Certified Development Company's own
 * back-office paperwork, filled in their own systems — not Buddy's data
 * to auto-fill, and not modeled here.
 *
 * Section One is a dual-entity (EPC + Operating Company) structure: the
 * form's own header confirms "Row1" fields are "Applicant Name (Eligible
 * Passive Company, if applicable)" and "Row1_2" fields are "Operating
 * Company (if Applicant is an EPC)" — verified by rendering the actual
 * page, not assumed from field-name suffixes alone.
 *
 * Section Two's real 5 yes/no questions have the SAME kind of stale/
 * copy-pasted tooltip bug found on Form 1919's Q5/Q6 — tooltips for
 * "42y/42n" through "45y/45n" don't line up with their printed question
 * numbers. The authoritative mapping below was confirmed by widget
 * y-coordinate against the rendered page (Q1 highest, Q5 lowest), not by
 * trusting the tooltip text — see the questions list below.
 */

export const FORM_1244_SECTION_I_TEXT_FIELDS = {
  applicant_legal_name: "Legal NameRow1",
  applicant_address: "Business AddressRow1",
  applicant_dba: "DBA or TradenameRow1",
  applicant_legal_structure: "Legal StructureRow1",
  applicant_tax_id: "Tax IDRow1",
  applicant_duns_number: "DUNS NumberRow1",
  applicant_contact_name: "Contact NameRow1",
  applicant_email: "Email AddressRow1",
  applicant_phone: "Phone Number xxxxxxxxxxRow1",
  applicant_website: "Business Web AddressRow1",

  oc_legal_name: "Legal NameRow1_2",
  oc_address: "Business AddressRow1_2",
  oc_dba: "DBA or TradenameRow1_2",
  oc_legal_structure: "Legal StructureRow1_2",
  oc_tax_id: "Tax IDRow1_2",
  oc_duns_number: "DUNS NumberRow1_2",
  oc_contact_name: "Contact NameRow1_2",
  oc_email: "Email AddressRow1_2",
  oc_phone: "Phone Number xxxxxxxxxxRow1_2",
  oc_website: "Business Web AddressRow1_2",

  project_address: "Project Address if different than OC Address Street City State Zip codeRow1",
  type_of_business: "Type of Business Summary DescriptionRow1",
  existing_employee_count: " of existing employees employed by business including owners who work for this businessRow1",
  jobs_to_be_created: " of jobs to be created in the next two years as a result of the loanRow1",
  jobs_to_be_retained: " of jobs to be retained in the next two years as a result of the loan including owners who work for this businessRow1",
  loan_purpose: "Purpose of the loan",
  prior_cdc_lender_name_and_program: "If yes provide CDCLender Name and Loan Program",
  loan_amount_required: "Loan Amount Required",
} as const;

export const FORM_1244_SECTION_I_CHECKBOX_FIELDS = {
  owned_by_401k: "401k",
  owned_by_esop: "ESOP",
  owned_by_trust: "Trust",
  owned_by_cooperative: "Cooperative",
  has_affiliates_yes: "21yes",
  has_affiliates_no: "21No",
  obtained_direct_or_guaranteed_loan_yes: "22Yes",
  obtained_direct_or_guaranteed_loan_no: "22No",
  prior_application_submitted_yes: "23yes",
  prior_application_submitted_no: "23no",
  ever_bankrupt_yes: "24yes",
  ever_bankrupt_no: "24No",
  pending_lawsuits_yes: "25yes",
  pending_lawsuits_no: "25No",
} as const;

/** Owner/Ownership roster (page 3) — up to 10 rows per entity, Applicant/EPC (Row1-10) and Operating Company (Row1_2-10_2). */
export const FORM_1244_APPLICANT_OWNER_ROSTER_FIELDS = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return {
    name: `OwnerEntity NameRow${n}`,
    title: `TitleOrganization TypeRow${n}`,
    ssnTin: `SSNTINRow${n}`,
    ownershipPct: `Ownership Row${n}`,
  };
});

export const FORM_1244_OC_OWNER_ROSTER_FIELDS = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return {
    name: `OwnerEntity NameRow${n}_2`,
    title: `TitleOrganization TypeRow${n}_2`,
    ssnTin: `SSNTINRow${n}_2`,
    ownershipPct: `Ownership Row${n}_2`,
  };
});

/** Section Two (page 4) — per-Associate. One instance in this template; extra associates need attached copies (the form's own page-11 instructions say as much for signatures). */
export const FORM_1244_SECTION_II_TEXT_FIELDS = {
  full_name: "Name Last First MiddleRow1",
  former_names_and_dates_used: "Former Names and Dates UsedRow1",
  uscis_registration_number: "USCIS Registration  if Legal Permanent ResidentYes No",
  country_of_citizenship: "If a nonUS citizen or LPR provide Country of CitizenshipYes No",
  place_of_birth: "Place of Birth City and State or Foreign CountryRow1",
  ssn_or_tin: "SSN or IRS TINRow1",
  date_of_birth: "Date of Birth mmddyyyyRow1",
  phone: "Phone Number Home or Cell xxxxxxxxxxRow1",
  home_address: "Home Address Street City State Zip codeRow1",
  sba_loan_entity_interest_details: "If yes provide loan numbers and current status",
} as const;

export const FORM_1244_SECTION_II_CHECKBOX_FIELDS = {
  is_us_citizen_yes: "citizenyes",
  is_us_citizen_no: "citizenno",
  // Q1 — ownership interest in another entity with existing SBA loans.
  sba_loan_entity_interest_yes: "Yes_1",
  sba_loan_entity_interest_no: "No_1",
  // Q2 — presently subject to indictment/criminal information/arraignment.
  // Position-verified (see file header) — tooltip text is wrong/copy-pasted.
  subject_to_indictment_yes: "42y",
  subject_to_indictment_no: "42n",
  // Q3 — arrested in the last 6 months.
  arrested_6mo_yes: "43y",
  arrested_6mo_no: "43n",
  // Q4 — ever convicted/pleaded guilty/nolo/pretrial diversion/parole.
  convicted_diversion_parole_yes: "44y",
  convicted_diversion_parole_no: "44n",
  // Q5 — presently suspended/debarred/ineligible/excluded from federal participation.
  suspended_debarred_yes: "45y",
  suspended_debarred_no: "45n",
} as const;

/** Section Three (page 11) — business-rep signature blocks + individual associate print-name/signature lines. */
export const FORM_1244_SECTION_III_TEXT_FIELDS = {
  applicant_legal_name_sig: "Legal Name of Applicant Business",
  applicant_epc_or_oc: "EPC or OC",
  applicant_dba_sig: "DBATrade Name if applicable",
  applicant_rep_print_name: "Print Name of Authorized Representative",
  applicant_rep_title: "Title",

  oc_legal_name_sig: "Legal Name of Business",
  oc_epc_or_oc: "EPC or OC_2",
  oc_dba_sig: "DBATrade Name if applicable_2",
  oc_rep_print_name: "Print Name of Authorized Representative_2",
  oc_rep_title: "Title_2",

  associate_print_name: "Print Name_2",
} as const;
