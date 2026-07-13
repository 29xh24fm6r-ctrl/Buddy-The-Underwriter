/**
 * IRS Form 4506-C — IVES Request for Transcript of Tax Return. One instance
 * per signer (spec H-1: "FORM_4506C always per signer") rather than
 * per-deal like 1919's sections — every individual owner and the borrower
 * business itself each sign their own 4506-C.
 *
 * pdfCoord omitted — same reasoning as form1919/fields.ts (no official
 * template ingested yet in this environment; sba.gov/irs.gov blocked).
 */

export type Form4506cField = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_4506C_SIGNER_FIELDS: Form4506cField[] = [
  { key: "taxpayer_name", label: "Taxpayer name (as shown on tax return)", required: true },
  { key: "taxpayer_id", label: "Taxpayer identification number (SSN or EIN)", required: true },
  { key: "spouse_name", label: "Spouse name (if joint return)", required: false },
  { key: "spouse_id", label: "Spouse identification number (if joint return)", required: false },
  { key: "current_address_street", label: "Current address — street", required: true },
  { key: "current_address_city", label: "Current address — city", required: true },
  { key: "current_address_state", label: "Current address — state", required: true },
  { key: "current_address_zip", label: "Current address — ZIP", required: true },
  { key: "previous_address_street", label: "Previous address (if moved in last 3 years) — street", required: false },
  { key: "transcript_type_return", label: "Return Transcript requested", required: true },
  { key: "transcript_type_account", label: "Account Transcript requested", required: true },
  { key: "transcript_type_wage_income", label: "Wage and Income Transcript requested", required: true },
  { key: "transcript_type_verification_nonfiling", label: "Verification of Non-filing requested", required: true },
  { key: "tax_form_numbers", label: "Tax form number(s) requested (e.g. 1040, 1120)", required: true },
  { key: "tax_years", label: "Tax year(s) requested", required: true },
];

export const FORM_4506C_THIRD_PARTY_FIELDS: Form4506cField[] = [
  { key: "recipient_name", label: "Third-party recipient name (lender)", required: true },
  { key: "recipient_address", label: "Third-party recipient address", required: false },
  { key: "recipient_phone", label: "Third-party recipient phone", required: false },
];

export function missingRequiredFields(fields: Form4506cField[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
