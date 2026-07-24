/**
 * SBA Form 148 (Unconditional Guarantee) / 148L (Unconditional Limited
 * Guarantee). Phase 5 spec: "one per guarantor; unlimited vs limited
 * decision driven by src/lib/ownership/rules.ts". Modeled as a single
 * form module since 148/148L differ only in guarantee type + which
 * official template gets filled (see render.ts) — not two separate field
 * sets for the fields they DO share.
 *
 * Rewritten against real copies of both current PDFs (see
 * pdfFieldMap.ts): neither form asks for the guarantor's address at all
 * (the old model required one) — dropped. The old single
 * `limited_guarantee_cap_amount` didn't match the real 148L, which has 7
 * mutually-exclusive limitation types, each with its own amount/rate/
 * description field — see FORM_148L_LIMITATION_FIELDS. "State-specific
 * provisions" has no data source anywhere (attorney/bank-supplied
 * boilerplate) and stays unmodeled/blank, same as Form 413's Sections
 * 5-8 before a real intake source existed.
 */

export type Form148Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_148_SIGNER_FIELDS: Form148Field[] = [
  { key: "guarantor_name", label: "Guarantor name", required: true },
  { key: "borrower_legal_name", label: "Borrower legal name", required: true },
  { key: "lender_name", label: "Lender name", required: true },
  { key: "loan_amount", label: "SBA loan amount", required: true },
  { key: "ownership_pct", label: "Ownership percentage", required: true },
];

/** Only asked when guaranteeType === "limited" — see build.ts. */
export const FORM_148L_LIMITATION_FIELDS: Form148Field[] = [
  { key: "guarantee_limitation_type", label: "Guarantee limitation type", required: true },
  { key: "limit_balance_under", label: "Released when total amount owing drops below", required: false },
  { key: "limit_principal_under", label: "Released when principal balance drops below", required: false },
  { key: "limit_max_payment", label: "Maximum guarantor payment", required: false },
  { key: "limit_percent_payment", label: "Percentage of amounts owing at demand", required: false },
  { key: "limit_time_years", label: "Years after final disbursement until release", required: false },
  { key: "limit_collateral_description", label: "Collateral the guarantee is limited to", required: false },
];

export function missingRequiredFields(fields: Form148Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
