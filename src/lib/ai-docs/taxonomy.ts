export type ChecklistKey =
  | "IRS_BUSINESS_3Y"
  | "IRS_PERSONAL_3Y"
  | "PFS_CURRENT"
  | "PROPERTY_T12"
  | "RENT_ROLL"
  | "PROPERTY_INSURANCE"
  | "LEASES_TOP"
  | "FIN_STMT_YTD"
  | "BANK_STMT_3M"
  | "APPRAISAL_IF_AVAILABLE"
  | "REAL_ESTATE_TAX_BILL"
  | "PROPERTY_USE_STATEMENT";

export type AiDocType =
  | "business_tax_return"
  | "personal_tax_return"
  | "personal_financial_statement"
  | "rent_roll"
  | "operating_statement"
  | "insurance_declarations"
  | "lease"
  | "ytd_financials"
  | "bank_statement"
  | "appraisal"
  | "tax_bill"
  | "use_statement"
  | "unknown";

export const CHECKLIST_RULES: Array<{
  key: ChecklistKey;
  accepts: AiDocType[];
  yearAware?: boolean;
}> = [
  { key: "IRS_BUSINESS_3Y", accepts: ["business_tax_return"], yearAware: true },
  { key: "IRS_PERSONAL_3Y", accepts: ["personal_tax_return"], yearAware: true },
  { key: "PFS_CURRENT", accepts: ["personal_financial_statement"] },
  { key: "PROPERTY_T12", accepts: ["operating_statement"] },
  { key: "RENT_ROLL", accepts: ["rent_roll"] },
  { key: "PROPERTY_INSURANCE", accepts: ["insurance_declarations"] },
  { key: "LEASES_TOP", accepts: ["lease"] },
  { key: "FIN_STMT_YTD", accepts: ["ytd_financials"] },
  { key: "BANK_STMT_3M", accepts: ["bank_statement"] },
  { key: "APPRAISAL_IF_AVAILABLE", accepts: ["appraisal"] },
  { key: "REAL_ESTATE_TAX_BILL", accepts: ["tax_bill"] },
  { key: "PROPERTY_USE_STATEMENT", accepts: ["use_statement"] },
];
