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
  | "EBITDA" | "EBIT" | "NET_OPERATING_PROFIT" | "CASH_FLOW_AVAILABLE";

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
