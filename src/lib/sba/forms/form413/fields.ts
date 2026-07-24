/**
 * SBA Form 413 — Personal Financial Statement. ~50 fields per signer
 * across identity, assets, liabilities, contingent liabilities, income,
 * itemized schedules, and signature/staleness.
 *
 * Field set rewritten against the real, current-revision PDF (see
 * docs/sba-forms/413-fields.json, dumped from a user-supplied copy —
 * sba.gov is blocked in this environment). Section 1 (identity + balance
 * sheet summary) was already conceptually correct — just a rename. Real
 * gaps found: the full SSN is required (not last-4), and the real form
 * has itemized supporting schedules this didn't model at all (notes
 * payable, securities, and up to 3 real estate properties instead of
 * one flat set) — see notes_payable/securities/real_estate_properties
 * below, sourced from the new borrower_pfs_* tables. See
 * docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md.
 */

export type Form413Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_413_FIELDS: Form413Field[] = [
  // Identity
  { key: "full_name", label: "Full legal name", required: true },
  { key: "address_street", label: "Address — street", required: true },
  { key: "address_city", label: "Address — city", required: true },
  { key: "address_state", label: "Address — state", required: true },
  { key: "address_zip", label: "Address — ZIP", required: true },
  { key: "business_phone", label: "Business phone", required: false },
  { key: "home_phone", label: "Home phone", required: true },
  { key: "full_ssn", label: "Social Security Number (full)", required: true },
  { key: "date_of_birth", label: "Date of birth", required: true },
  { key: "business_name", label: "Name of business", required: true },
  { key: "business_entity_type", label: "Business type (Corporation/S-Corp/LLC/Partnership/Sole Proprietor)", required: false },

  // Assets
  { key: "asset_cash_on_hand_and_in_banks", label: "Cash on hand & in banks", required: true },
  { key: "asset_savings_accounts", label: "Savings accounts", required: false },
  { key: "asset_ira_retirement", label: "IRA / other retirement accounts", required: false },
  { key: "asset_accounts_notes_receivable", label: "Accounts & notes receivable", required: false },
  { key: "asset_life_insurance_cash_surrender_value", label: "Life insurance — cash surrender value", required: false },
  { key: "asset_stocks_bonds", label: "Stocks and bonds", required: false },
  { key: "asset_real_estate", label: "Real estate", required: true },
  { key: "asset_automobile", label: "Automobile(s) present value", required: false },
  { key: "asset_other_personal_property", label: "Other personal property", required: false },
  { key: "asset_other", label: "Other assets", required: false },
  { key: "asset_total", label: "Total assets", required: true },

  // Liabilities
  { key: "liability_accounts_payable", label: "Accounts payable", required: false },
  { key: "liability_notes_payable_banks_others", label: "Notes payable to banks/others", required: false },
  { key: "liability_installment_auto", label: "Installment account — auto", required: false },
  { key: "liability_installment_other", label: "Installment account — other", required: false },
  { key: "liability_loan_on_life_insurance", label: "Loan(s) against life insurance", required: false },
  { key: "liability_mortgages_on_real_estate", label: "Mortgages on real estate", required: true },
  { key: "liability_unpaid_taxes", label: "Unpaid taxes", required: false },
  { key: "liability_other", label: "Other liabilities", required: false },
  { key: "liability_total", label: "Total liabilities", required: true },
  { key: "net_worth", label: "Net worth", required: true },

  // Contingent liabilities
  { key: "contingent_as_endorser_or_comaker", label: "As endorser or co-maker", required: false },
  { key: "contingent_legal_claims_judgments", label: "Legal claims & judgments", required: false },
  { key: "contingent_provision_for_federal_income_tax", label: "Provision for federal income tax", required: false },
  { key: "contingent_other_special_debt", label: "Other special debt", required: false },

  // Income
  { key: "income_salary", label: "Salary", required: true },
  { key: "income_net_investment", label: "Net investment income", required: false },
  { key: "income_real_estate", label: "Real estate income", required: false },
  { key: "income_other", label: "Other income", required: false },
  { key: "income_other_description", label: "Description of other income", required: false },

  // Itemized schedules (arrays — see build.ts's widened field-value type)
  { key: "notes_payable", label: "Section 2 — notes payable schedule (up to 5 rows)", required: false },
  { key: "securities", label: "Section 3 — securities schedule (up to 4 rows)", required: false },
  { key: "real_estate_properties", label: "Section 4 — real estate owned (up to 3 properties)", required: false },
  { key: "other_personal_property_description", label: "Section 5 — other personal property/assets description", required: false },
  { key: "unpaid_taxes_description", label: "Section 6 — unpaid taxes description", required: false },
  { key: "other_liabilities_description", label: "Section 7 — other liabilities description", required: false },
  { key: "life_insurance_description", label: "Section 8 — life insurance held description", required: false },

  // Signature / staleness
  { key: "signed_at", label: "Date signed", required: true },
  { key: "has_spouse", label: "Has spouse (joint filer)?", required: true },
  { key: "spouse_full_name", label: "Spouse full name", required: false },
  { key: "spouse_full_ssn", label: "Spouse Social Security Number (full, if joint filer)", required: false },
  { key: "spouse_signed_at", label: "Spouse date signed", required: false },
];

export function missingRequiredFields(fields: Form413Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
