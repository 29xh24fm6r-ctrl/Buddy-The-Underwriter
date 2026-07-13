/**
 * SBA Form 912 — Statement of Personal History. Conditional generator
 * (SPEC S4 A-S4-3 / G-2): only produced for owners whose Form 1919 Section
 * II criminal-history answers (FORM_912_TRIGGER_FIELDS) are true.
 */

export type Form912Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_912_FIELDS: Form912Field[] = [
  { key: "full_name", label: "Full legal name", required: true },
  { key: "all_other_names_used", label: "All other names used", required: false },
  { key: "date_of_birth", label: "Date of birth", required: true },
  { key: "place_of_birth", label: "Place of birth", required: true },
  { key: "ssn_last4", label: "SSN — last 4", required: true },
  { key: "citizenship_status", label: "U.S. citizenship status", required: true },
  { key: "current_address_street", label: "Current address — street", required: true },
  { key: "current_address_city", label: "Current address — city", required: true },
  { key: "current_address_state", label: "Current address — state", required: true },
  { key: "current_address_zip", label: "Current address — ZIP", required: true },
  { key: "residence_history_5yr", label: "Residence history (last 5 years)", required: true },
  { key: "arrest_or_charge_explanation", label: "Explanation of arrest(s)/charge(s) in last 6 months", required: true },
  { key: "conviction_explanation", label: "Explanation of conviction(s)/plea(s)", required: true },
  { key: "indictment_explanation", label: "Explanation of pending indictment", required: false },
  { key: "parole_probation_explanation", label: "Explanation of parole/probation status", required: false },
];

export function missingRequiredFields(fields: Form912Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
