import {
  FORM_1919_SECTION_II_FIELDS,
  FORM_1919_SECTION_III_FIELDS,
  FORM_912_TRIGGER_FIELDS,
  missingRequiredFields,
  type Form1919Field,
} from "@/lib/sba/forms/form1919/fields";

/**
 * SBA Form 1244 — 504 Loan Application. Phase 4 spec: "same certification
 * sections as 1919" for the per-individual / per-entity disclosures — so
 * Section II/III are imported directly from form1919/fields.ts rather than
 * duplicated (same personal-history questions drive the same Form 912
 * trigger for both programs, per A-S4-3 parity).
 *
 * pdfCoord omitted — same reasoning as every other form module in this
 * arc (no official template ingested yet; sba.gov blocked).
 */

export type Form1244Field = Form1919Field;

export const FORM_1244_SECTION_I_FIELDS: Form1244Field[] = [
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
  { key: "project_address_street", label: "Project property address — street", required: true },
  { key: "project_address_city", label: "Project property address — city", required: true },
  { key: "project_address_state", label: "Project property address — state", required: true },
  { key: "project_address_zip", label: "Project property address — ZIP", required: true },
  { key: "total_project_cost", label: "Total project cost", required: true },
  { key: "third_party_lender_amount", label: "Third-party lender amount (~50%)", required: true },
  { key: "cdc_debenture_amount", label: "CDC/SBA debenture amount (~40%)", required: true },
  { key: "borrower_contribution_amount", label: "Borrower contribution (~10%)", required: true },
  { key: "occupancy_percentage", label: "Owner-occupancy percentage", required: true },
  { key: "creates_or_retains_jobs", label: "Creates or retains jobs?", required: true },
  { key: "jobs_created_count", label: "Jobs created", required: false },
  { key: "jobs_retained_count", label: "Jobs retained", required: false },
  { key: "meets_public_policy_goal", label: "Meets a public policy goal?", required: true },
  { key: "public_policy_goal_description", label: "Public policy goal description", required: false },
  { key: "includes_debt_refinance", label: "Includes debt refinancing?", required: true },
  { key: "debt_refinance_amount", label: "Debt refinance amount", required: false },
  { key: "is_franchise_deal", label: "Is this a franchise?", required: true },
  { key: "franchise_identifier_code", label: "Franchise identifier code", required: false },
  { key: "franchise_brand_name", label: "Franchise brand name", required: false },
  { key: "has_other_sba_application_pending", label: "Other SBA application pending?", required: true },
  { key: "has_been_in_bankruptcy_pending", label: "Bankruptcy pending?", required: true },
  { key: "has_pending_lawsuits", label: "Pending lawsuits?", required: true },
  { key: "is_engaged_in_lobbying", label: "Engaged in lobbying activities?", required: true },
];

export const FORM_1244_SECTION_II_FIELDS = FORM_1919_SECTION_II_FIELDS;
export const FORM_1244_SECTION_III_FIELDS = FORM_1919_SECTION_III_FIELDS;
export { FORM_912_TRIGGER_FIELDS, missingRequiredFields };
