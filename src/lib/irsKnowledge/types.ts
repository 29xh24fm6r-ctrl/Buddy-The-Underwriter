// Canonical fact keys — universal keys used across all form types
export type CanonicalFactKey =
  | "GROSS_RECEIPTS" | "RETURNS_ALLOWANCES" | "NET_RECEIPTS"
  | "COST_OF_GOODS_SOLD" | "GROSS_PROFIT" | "TOTAL_INCOME"
  | "OFFICER_COMPENSATION" | "SALARIES_WAGES" | "REPAIRS_MAINTENANCE"
  | "BAD_DEBTS" | "RENT_EXPENSE" | "TAXES_LICENSES"
  | "INTEREST_EXPENSE" | "DEPRECIATION" | "AMORTIZATION"
  | "DEPLETION" | "RETIREMENT_PLANS" | "EMPLOYEE_BENEFITS"
  | "OTHER_DEDUCTIONS" | "TOTAL_DEDUCTIONS"
  | "ORDINARY_BUSINESS_INCOME" | "NET_RENTAL_INCOME"
  | "TOTAL_PASSTHROUGH_INCOME" | "TAXABLE_INCOME" | "NET_PROFIT"
  | "SECTION_179_EXPENSE" | "BONUS_DEPRECIATION"
  | "GUARANTEED_PAYMENTS" | "NON_RECURRING_EXPENSE" | "NON_RECURRING_INCOME"
  | "CASH_AND_EQUIVALENTS" | "ACCOUNTS_RECEIVABLE" | "INVENTORY"
  | "OTHER_CURRENT_ASSETS" | "TOTAL_CURRENT_ASSETS"
  | "FIXED_ASSETS_GROSS" | "ACCUMULATED_DEPRECIATION" | "FIXED_ASSETS_NET"
  | "INTANGIBLES_NET" | "OTHER_NONCURRENT_ASSETS" | "TOTAL_NONCURRENT_ASSETS"
  | "TOTAL_ASSETS"
  | "ACCOUNTS_PAYABLE" | "ST_LOANS_PAYABLE" | "ACCRUED_LIABILITIES"
  | "OTHER_CURRENT_LIABILITIES" | "TOTAL_CURRENT_LIABILITIES"
  | "LT_DEBT" | "OTHER_LT_LIABILITIES" | "TOTAL_LIABILITIES"
  | "COMMON_STOCK" | "PAID_IN_CAPITAL" | "RETAINED_EARNINGS"
  | "PARTNERS_CAPITAL" | "TOTAL_EQUITY" | "TOTAL_LIABILITIES_AND_EQUITY"
  | "K1_ORDINARY_INCOME" | "K1_NET_RENTAL_INCOME"
  | "K1_GUARANTEED_PAYMENTS" | "K1_PARTNER_COUNT" | "K1_OWNERSHIP_PCT"
  | "M1_NET_INCOME_PER_BOOKS" | "M1_DEPRECIATION_TIMING"
  | "M1_MEALS_ENTERTAINMENT" | "M1_OTHER_NONDEDUCTIBLE"
  | "EBITDA" | "EBIT" | "NET_OPERATING_PROFIT" | "CASH_FLOW_AVAILABLE"
  | "TOTAL_REVENUE" | "TOTAL_OPERATING_EXPENSES"
  | "REVENUE_GROWTH_PCT" | "EBITDA_GROWTH_PCT"
  // K-1 keys (Schedule K-1 — 1120-S and 1065)
  | "K1_OWNER_NAME" | "K1_ENTITY_EIN"
  | "K1_CAP_ACCT_BEGIN" | "K1_CAP_ACCT_END"
  | "K1_RENTAL_RE_INCOME" | "K1_OTHER_RENTAL"
  | "K1_INTEREST_INCOME" | "K1_QUALIFIED_DIVIDENDS" | "K1_ORDINARY_DIVIDENDS"
  | "K1_ROYALTIES" | "K1_ST_CAP_GAIN" | "K1_LT_CAP_GAIN"
  | "K1_1231_GAIN" | "K1_OTHER_INCOME"
  | "K1_SEC179_DEDUCTION" | "K1_CASH_DISTRIBUTIONS" | "K1_OTHER_INFO"
  // Schedule C keys (sole proprietor)
  | "SCH_C_BUSINESS_NAME" | "SCH_C_NAICS"
  | "SCH_C_GROSS_RECEIPTS" | "SCH_C_RETURNS" | "SCH_C_NET_SALES"
  | "SCH_C_COGS" | "SCH_C_GROSS_PROFIT" | "SCH_C_OTHER_INCOME"
  | "SCH_C_GROSS_INCOME" | "SCH_C_ADVERTISING" | "SCH_C_AUTO"
  | "SCH_C_COMMISSIONS" | "SCH_C_CONTRACT_LABOR"
  | "SCH_C_DEPLETION" | "SCH_C_DEPRECIATION"
  | "SCH_C_EMPLOYEE_BENEFITS" | "SCH_C_INSURANCE"
  | "SCH_C_MORTGAGE_INTEREST" | "SCH_C_OTHER_INTEREST"
  | "SCH_C_LEGAL_PROFESSIONAL" | "SCH_C_OFFICE" | "SCH_C_PENSION"
  | "SCH_C_VEHICLE_RENT" | "SCH_C_EQUIPMENT_RENT"
  | "SCH_C_REPAIRS" | "SCH_C_SUPPLIES" | "SCH_C_TAXES_LICENSES"
  | "SCH_C_TRAVEL" | "SCH_C_MEALS" | "SCH_C_UTILITIES"
  | "SCH_C_WAGES" | "SCH_C_OTHER_EXPENSES" | "SCH_C_TOTAL_EXPENSES"
  | "SCH_C_HOME_OFFICE" | "SCH_C_NET_PROFIT"
  // Schedule E keys (supplemental income)
  | "SCH_E_PROPERTY_ADDRESS" | "SCH_E_RENTS_RECEIVED"
  | "SCH_E_ROYALTIES_RECEIVED" | "SCH_E_MORTGAGE_INTEREST"
  | "SCH_E_DEPRECIATION" | "SCH_E_NET_PER_PROPERTY"
  | "SCH_E_PASSIVE_LOSS" | "SCH_E_RENTAL_TOTAL"
  | "SCH_E_ENTITY_NAME" | "SCH_E_PASSIVE_FLAG"
  | "SCH_E_PASSIVE_INCOME" | "SCH_E_NONPASSIVE_LOSS"
  | "SCH_E_PASSIVE_LOSS_LIMITED" | "SCH_E_NONPASSIVE_INCOME"
  // W-2 keys (wage & salary)
  | "W2_WAGES" | "W2_FED_TAX_WITHHELD"
  | "W2_SS_WAGES" | "W2_SS_TAX"
  | "W2_MEDICARE_WAGES" | "W2_MEDICARE_TAX"
  | "W2_DEP_CARE" | "W2_NQDC"
  | "W2_BOX12_DETAIL" | "W2_CHECKBOXES" | "W2_OTHER_DETAIL"
  | "W2_EMPLOYER_NAME" | "W2_EMPLOYEE_NAME" | "W2_SSN_LAST4"
  // 1099 keys (all variants)
  | "F1099NEC_NONEMPLOYEE_COMP"
  | "F1099MISC_RENTS" | "F1099MISC_ROYALTIES"
  | "F1099MISC_OTHER_INCOME" | "F1099MISC_MEDICAL"
  | "F1099INT_INTEREST" | "F1099INT_US_SAVINGS" | "F1099INT_TAX_EXEMPT"
  | "F1099DIV_ORDINARY" | "F1099DIV_QUALIFIED" | "F1099DIV_CAP_GAIN"
  | "F1099R_GROSS_DISTRIBUTION" | "F1099R_TAXABLE" | "F1099R_DISTRIBUTION_CODE"
  | "SSA1099_NET_BENEFITS";

export type IrsFormType =
  | "FORM_1065" | "FORM_1120" | "FORM_1120S" | "FORM_1040"
  | "SCHEDULE_C" | "SCHEDULE_E" | "SCHEDULE_F"
  | "SCHEDULE_K1_1065" | "SCHEDULE_K1_1120S"
  | "SCHEDULE_L" | "SCHEDULE_M1" | "SCHEDULE_M2"
  | "FORM_1125A" | "FORM_4562" | "FORM_8825"
  | "AUDITED_FINANCIALS" | "REVIEWED_FINANCIALS"
  | "COMPILED_FINANCIALS" | "INTERIM_FINANCIALS" | "BANK_STATEMENTS";

// When same value exists in multiple docs, higher trust wins
export const DOCUMENT_TRUST_LEVEL: Record<IrsFormType, number> = {
  AUDITED_FINANCIALS: 100,
  REVIEWED_FINANCIALS: 80,
  FORM_1120: 70, FORM_1120S: 70, FORM_1065: 70,
  FORM_1040: 65, SCHEDULE_C: 65, SCHEDULE_E: 65, SCHEDULE_F: 65,
  COMPILED_FINANCIALS: 60,
  SCHEDULE_K1_1065: 55, SCHEDULE_K1_1120S: 55,
  SCHEDULE_L: 50, SCHEDULE_M1: 50, SCHEDULE_M2: 50,
  FORM_1125A: 50, FORM_4562: 50, FORM_8825: 50,
  INTERIM_FINANCIALS: 40,
  BANK_STATEMENTS: 30,
};

export type FieldDefinition = {
  canonicalKey: CanonicalFactKey;
  lineNumbers: string[];          // May vary by tax year
  label: string;
  labelVariants: string[];        // Different tax software uses different labels
  requiredForValidation: boolean;
  nullAsZero: boolean;            // True = missing means 0, not invalid
  isEbitdaAddBack: boolean;
  notes?: string;
};

export type IdentityCheck = {
  id: string;
  description: string;
  lhs: CanonicalFactKey[];        // Left side: sum of these keys
  rhs: CanonicalFactKey[];        // Right side: sum of these keys
  operator: "=" | "≈";
  toleranceDollars: number;
  requiredForValidation: boolean;
  sourceDescription: string;
};

export type FormSpecification = {
  formType: IrsFormType;
  taxYear: number;
  version: number;
  description: string;
  fields: FieldDefinition[];
  identityChecks: IdentityCheck[];
  ebitdaAddBackKeys: CanonicalFactKey[];
  softwareVariants: string[];     // Known tax software that produces this form
};

export type ValidationStatus = "VERIFIED" | "FLAGGED" | "BLOCKED" | "PARTIAL";

export type IdentityCheckResult = {
  checkId: string;
  description: string;
  lhsValue: number | null;
  rhsValue: number | null;
  delta: number | null;
  toleranceDollars: number;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
};

export type DocumentValidationResult = {
  documentId: string;
  formType: IrsFormType;
  taxYear: number;
  status: ValidationStatus;
  checkResults: IdentityCheckResult[];
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  summary: string;
  validatedAt: string;
};
