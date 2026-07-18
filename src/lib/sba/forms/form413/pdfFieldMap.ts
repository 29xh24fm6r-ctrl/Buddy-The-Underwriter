/**
 * Real AcroForm field names for SBA Form 413, extracted from
 * docs/sba-forms/413-fields.json (dumped via pdf-lib from a
 * user-supplied copy of the current-revision PDF; confirmed against
 * each field's own /TU tooltip — this PDF's tooltips are short but
 * accurate, e.g. "Cash on Hand & in banks").
 *
 * The identity section has no SSN field at all — the only two SSN
 * fields on the whole form are in the SIGNATURE block ("Social Security
 * No" / "Social Security No_2" for a joint filer), confirmed by field
 * order and tooltip ("Enter Social Security No for Name 1...").
 *
 * "Home Address" and "City, State, & Zip Code" are two separate fields
 * (street, then combined city/state/zip) — not four.
 *
 * Deliberately NOT mapped — signer-ceremony fields: "Signature"/
 * "Signature_2" (PDFSignature) and "Date"/"Date2" (filled by the signer
 * at signing time, not pre-filled).
 */

export const FORM_413_TEXT_FIELDS: Record<string, string> = {
  full_name: "Name",
  business_phone: "Business Phone xxx-xxx-xxxx",
  home_address_street: "Home Address",
  home_city_state_zip: "City, State, & Zip Code",
  home_phone: "Home Phone xxx-xxx-xxxx",
  business_name: "Business Name of Applicant/Borrower",
  asset_cash_on_hand_and_in_banks: "Cash on Hand & in banks",
  asset_savings_accounts: "Savings Accounts",
  asset_ira_retirement: "IRA or Other Retirement Account",
  asset_accounts_notes_receivable: "Accounts and Notes Receivable",
  asset_life_insurance_cash_surrender_value: "Life Insurance - Cash Surrender Value Only",
  asset_stocks_bonds: "Stocks and Bonds",
  asset_real_estate: "Real Estate",
  asset_automobile: "Automobiles",
  asset_other_personal_property: "Other Personal Property",
  asset_other: "Other Assets",
  asset_total: "TotalAssets",
  liability_accounts_payable: "Accounts Payable",
  liability_notes_payable_banks_others: "Notes Payable to Banks and Others",
  liability_installment_auto: "Installment Account (Auto)",
  liability_installment_other: "Installment Account (Other)",
  liability_loan_on_life_insurance: "Loan(s) Against Life Insurance",
  liability_mortgages_on_real_estate: "Mortgages on Real Estate",
  liability_unpaid_taxes: "Unpaid Taxes",
  liability_other: "Other Liabilities",
  liability_total: "TotalLiabilities",
  net_worth: "Net Worth",
  contingent_as_endorser_or_comaker: "As Endorser or Co-Maker",
  contingent_legal_claims_judgments: "Legal Claims and Judgements",
  contingent_provision_for_federal_income_tax: "Provision for Federal Income Tax",
  contingent_other_special_debt: "Other Special Debt",
  income_salary: "Salary",
  income_net_investment: "Net Investment Income",
  income_real_estate: "Real Estate Income",
  income_other: "Other Income",
  income_other_description:
    "Description of Other Income in Section 1: Alimony or child support payments should not be disclosed in Other Income unless it is desired to have such payments counted toward total incomeRow1",
  other_personal_property_description:
    "Section 5  Other Personal Property and Other Assets: Describe and if any is pledged as security state name and address of lien holder amount of lien terms of payment and if delinquent describe delinquencyRow1",
  unpaid_taxes_description:
    "Section 6 Unpaid Taxes Describe in detail as to type to whom payable when due amount and to what property if any a tax lien attachesRow1",
  other_liabilities_description: "Section 7 Other Liabilities Describe in detailRow1",
  life_insurance_description:
    "Section 8 Life Insurance Held Give face amount and cash surrender value of policies  name of insurance company and BeneficiariesRow1",
  print_name: "Print Name",
  full_ssn: "Social Security No",
  spouse_print_name: "Print Name_2",
  spouse_full_ssn: "Social Security No_2",
};

export const FORM_413_CHECKBOX_FIELDS: Record<string, string> = {
  business_type_corporation: "Business Type: Corporation",
  business_type_s_corp: "Business Type: S-Corp",
  business_type_llc: "Business Type: LLC",
  business_type_partnership: "Business Type: Partnership",
  business_type_sole_prop: "Business Type: Sole Proprietor",
  married_yes: "WOSB Applicant Married Yes",
  married_no: "WOSB Applicant Married No",
};

/** Section 2 — up to 5 notes payable rows. */
export const FORM_413_NOTES_PAYABLE_FIELDS: Array<{
  noteholder: string;
  originalBalance: string;
  currentBalance: string;
  paymentAmount: string;
  frequency: string;
  collateral: string;
}> = [1, 2, 3, 4, 5].map((n) => ({
  noteholder: `Names and Addresses of NoteholdersRow${n}`,
  originalBalance: `Original BalanceRow${n}`,
  currentBalance: `Current BalanceRow${n}`,
  paymentAmount: `Payment AmountRow${n}`,
  frequency: `Frequency monthly etcRow${n}`,
  collateral: `How Secured or Endorsed Type of CollateralRow${n}`,
}));

/** Section 3 — up to 4 securities rows. */
export const FORM_413_SECURITIES_FIELDS: Array<{
  shares: string;
  name: string;
  cost: string;
  marketValueQuotation: string;
  dateOfQuotation: string;
  totalValue: string;
}> = [1, 2, 3, 4].map((n) => ({
  shares: `Number of SharesRow${n}`,
  name: `Name of SecuritiesRow${n}`,
  cost: `CostRow${n}`,
  marketValueQuotation: `Market Value QuotationExchangeRow${n}`,
  dateOfQuotation: `Date of QuotationExchangeRow${n}`,
  totalValue: `Total ValueRow${n}`,
}));

/** Section 4 — 3 real estate properties, A/B/C. */
export const FORM_413_REAL_ESTATE_FIELDS: Record<"A" | "B" | "C", {
  type: string;
  address: string;
  datePurchased: string;
  originalCost: string;
  presentMarketValue: string;
  mortgageHolder: string;
  mortgageAccountNumber: string;
  mortgageBalance: string;
  paymentPerMonthYear: string;
  status: string;
}> = {
  A: {
    type: "Property AType of Real Estate eg Primary Residence Other Residence Rental Property Land etc",
    address: "Property AAddress",
    datePurchased: "Property ADate Purchased_es_:date",
    originalCost: "Property AOriginal Cost",
    presentMarketValue: "Property APresent Market Value",
    mortgageHolder: "Property AName  Address of Mortgage Holder",
    mortgageAccountNumber: "Property AMortgage Account Number",
    mortgageBalance: "Property AMortgage Balance",
    paymentPerMonthYear: "Property AAmount of Payment per MonthYear",
    status: "Property AStatus of Mortgage",
  },
  B: {
    type: "Property BType of Real Estate eg Primary Residence Other Residence Rental Property Land etc",
    address: "Property BAddress",
    datePurchased: "Property BDate Purchased_es_:date",
    originalCost: "Property BOriginal Cost",
    presentMarketValue: "Property BPresent Market Value",
    mortgageHolder: "Property BName  Address of Mortgage Holder",
    mortgageAccountNumber: "Property BMortgage Account Number",
    mortgageBalance: "Property BMortgage Balance",
    paymentPerMonthYear: "Property BAmount of Payment per MonthYear",
    status: "Property BStatus of Mortgage",
  },
  C: {
    type: "Property CType of Real Estate eg Primary Residence Other Residence Rental Property Land etc",
    address: "Property CAddress",
    datePurchased: "Property CDate Purchased_es_:date",
    originalCost: "Property COriginal Cost",
    presentMarketValue: "Property CPresent Market Value",
    mortgageHolder: "Property CName  Address of Mortgage Holder",
    mortgageAccountNumber: "Property CMortgage Account Number",
    mortgageBalance: "Property CMortgage Balance",
    paymentPerMonthYear: "Property CAmount of Payment per MonthYear",
    status: "Property CStatus of Mortgage",
  },
};
