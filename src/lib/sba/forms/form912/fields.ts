/**
 * SBA Form 912 — Statement of Personal History. Conditional generator
 * (SPEC S4 A-S4-3 / G-2): only produced for owners whose Form 1919
 * Section II criminal-history answer (FORM_912_TRIGGER_FIELDS) is true.
 *
 * Field set rewritten against the real, current-revision PDF (see
 * docs/sba-forms/912-fields.json, dumped from a user-supplied copy of the
 * form — sba.gov is blocked in this environment). The prior field list
 * modeled an older form revision: it asked five broad categories
 * (arrest/conviction/pending-charges/indictment/parole) where the current
 * form asks exactly three, narrower questions, and it stored only a
 * last-4 SSN where the real form requires the full SSN (§3). See
 * docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md for the full
 * finding.
 */

export type Form912Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_912_FIELDS: Form912Field[] = [
  { key: "business_name_address_email", label: "Applicant/Borrower business name, address, and email (§1a)", required: true },
  { key: "full_name", label: "Full legal name (§1b)", required: true },
  { key: "all_other_names_used", label: "All other names used (§1b)", required: false },
  { key: "ownership_percentage", label: "Percentage of ownership (§2)", required: true },
  { key: "full_ssn", label: "Social Security Number (§3)", required: true },
  { key: "date_of_birth", label: "Date of birth (§4)", required: true },
  { key: "place_of_birth", label: "Place of birth (§5)", required: true },
  { key: "is_us_citizen", label: "U.S. citizen? (§6)", required: true },
  { key: "alien_registration_number", label: "Alien registration number (§6, if not a citizen)", required: false },
  { key: "current_address_street", label: "Present residence address — street (§7)", required: true },
  { key: "current_address_city", label: "Present residence address — city (§7)", required: true },
  { key: "current_address_state", label: "Present residence address — state (§7)", required: true },
  { key: "current_address_zip", label: "Present residence address — ZIP (§7)", required: true },
  { key: "home_phone", label: "Home telephone number", required: false },
  { key: "business_phone", label: "Business telephone number", required: false },
  { key: "prior_address_street", label: "Most recent prior address — street (omit if over 10 years ago)", required: false },
  { key: "prior_address_city", label: "Most recent prior address — city", required: false },
  { key: "prior_address_state", label: "Most recent prior address — state", required: false },
  { key: "prior_address_zip", label: "Most recent prior address — ZIP", required: false },
  { key: "signer_title", label: "Title (signature block)", required: false },
  { key: "incarcerated_or_indicted_financial_crime", label: "Currently incarcerated, serving a sentence, or under indictment for a felony or financial-misconduct/false-statement crime? (§8)", required: true },
  { key: "riot_related_conviction_past_year", label: "Convicted in the past year of a riot/civil-disorder-related offense? (§9)", required: true },
  { key: "delinquent_child_support_60days", label: "More than 60 days delinquent on child support? (§10)", required: true },
];

export function missingRequiredFields(fields: Form912Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
