/**
 * IRS Form 4506-C — IVES Request for Transcript of Tax Return. One instance
 * per signer (spec H-1: "FORM_4506C always per signer") rather than
 * per-deal like 1919's sections — every individual owner and the borrower
 * business itself each sign their own 4506-C.
 *
 * Field set rewritten against the real, current-revision PDF (see
 * docs/sba-forms/4506c-fields.json, dumped from a user-supplied copy —
 * irs.gov is blocked in this environment). Real differences from the
 * prior version: line 6 (Return/Account/**Record of Account**) is a
 * separate, single-tax-form-number request from line 7 (Wage and Income
 * transcript, its own up-to-3-form-numbers sub-request); "Verification of
 * Non-filing" doesn't exist as a field on this revision at all. Line 1b
 * wants the FULL taxpayer SSN/EIN, not a masked value — see
 * docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md.
 */

export type Form4506cField = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_4506C_SIGNER_FIELDS: Form4506cField[] = [
  { key: "taxpayer_first_name", label: "Taxpayer first name (§1a)", required: true },
  { key: "taxpayer_last_name", label: "Taxpayer last name / BMF company name (§1a)", required: true },
  { key: "taxpayer_middle_initial", label: "Taxpayer middle initial (§1a)", required: false },
  { key: "taxpayer_id", label: "Taxpayer identification number — full SSN or EIN (§1b)", required: true },
  { key: "previous_first_name", label: "Previous first name, if different from §1a (§1c)", required: false },
  { key: "previous_last_name", label: "Previous last name (§1c)", required: false },
  { key: "spouse_first_name", label: "Spouse first name, if joint return (§2a)", required: false },
  { key: "spouse_last_name", label: "Spouse last name (§2a)", required: false },
  { key: "spouse_id", label: "Spouse taxpayer identification number (§2b)", required: false },
  { key: "current_address_street", label: "Current address — street (§3)", required: true },
  { key: "current_address_city", label: "Current address — city (§3)", required: true },
  { key: "current_address_state", label: "Current address — state (§3)", required: true },
  { key: "current_address_zip", label: "Current address — ZIP (§3)", required: true },
  { key: "previous_address_street", label: "Previous address, if different from §3 (§4)", required: false },
  { key: "customer_file_number", label: "Customer file number (§5b)", required: false },
  { key: "tax_form_number_line6", label: "Tax form number for §6 transcript request (e.g. 1040)", required: true },
  { key: "transcript_type_return", label: "Return Transcript requested (§6a)", required: true },
  { key: "transcript_type_account", label: "Account Transcript requested (§6b)", required: false },
  { key: "transcript_type_record_of_account", label: "Record of Account requested (§6c)", required: false },
  { key: "wants_wage_income_transcript", label: "Wage and Income transcript requested (§7)", required: true },
  { key: "wage_income_form_numbers", label: "Form numbers for the §7 wage/income request (up to 3)", required: false },
  { key: "tax_periods", label: "Tax year(s)/period(s) requested (§8, up to 4)", required: true },
  { key: "signer_print_name", label: "Print/type name (signature block)", required: true },
  { key: "signer_title", label: "Title, if signing for a corporation/partnership/estate/trust", required: false },
  { key: "signer_phone", label: "Phone number of the taxpayer on line 1a or 2a", required: false },
];

export const FORM_4506C_THIRD_PARTY_FIELDS: Form4506cField[] = [
  { key: "client_name", label: "Requesting client name (§5d — cannot be blank per IRS instructions)", required: true },
  { key: "client_phone", label: "Requesting client phone (§5d)", required: false },
  { key: "client_address", label: "Requesting client address (§5d)", required: false },
];

export function missingRequiredFields(fields: Form4506cField[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
