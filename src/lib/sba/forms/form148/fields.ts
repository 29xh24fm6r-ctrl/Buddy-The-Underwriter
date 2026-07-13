/**
 * SBA Form 148 (Unconditional Guarantee) / 148L (Limited Guarantee).
 * Phase 5 spec: "one per guarantor; unlimited vs limited decision driven
 * by src/lib/ownership/rules.ts". Modeled as a single form module since
 * 148/148L differ only in guarantee type + which official template gets
 * filled (see render.ts) — not two separate field sets.
 */

export type Form148Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_148_SIGNER_FIELDS: Form148Field[] = [
  { key: "guarantor_name", label: "Guarantor name", required: true },
  { key: "guarantor_address_street", label: "Guarantor address — street", required: true },
  { key: "guarantor_address_city", label: "Guarantor address — city", required: true },
  { key: "guarantor_address_state", label: "Guarantor address — state", required: true },
  { key: "guarantor_address_zip", label: "Guarantor address — ZIP", required: true },
  { key: "borrower_legal_name", label: "Borrower legal name", required: true },
  { key: "lender_name", label: "Lender name", required: true },
  { key: "loan_amount", label: "SBA loan amount", required: true },
  { key: "ownership_pct", label: "Ownership percentage", required: true },
  // Only required when guaranteeType === "limited" — enforced in build.ts,
  // not here, since a static field-list can't express that condition.
  { key: "limited_guarantee_cap_amount", label: "Limited guarantee cap amount", required: false },
];

export function missingRequiredFields(fields: Form148Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
