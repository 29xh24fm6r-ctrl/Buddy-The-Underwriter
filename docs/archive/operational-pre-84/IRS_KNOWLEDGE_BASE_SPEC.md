# Buddy IRS Knowledge Base — Build Specification

**Priority: P0 — Foundation for all spread accuracy**
**Branch: `feature/irs-knowledge-base`**
**Owner: Antigravity (Claude Code)**

---

## Why This Exists

Buddy must be an institutional-grade expert on IRS forms, GAAP, and commercial credit.
Every spread that reaches a credit committee must be mathematically verified.
This knowledge base is the enforcement layer that makes that possible.

Without this, extraction errors reach spreads silently.
With this, every number is verified before it renders.

---

## What To Build — 5 Files, One Branch

### FILE 1: `src/lib/irsKnowledge/types.ts`

Core TypeScript types for the entire domain intelligence system.

```typescript
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
```

---

### FILE 2: `src/lib/irsKnowledge/formSpecs/form1065.ts`

Complete Form 1065 specifications for tax years 2021-2024.
**Critical note**: Line 22 (OBI) in 2022 became Line 23 in 2024. This file must encode both.

```typescript
import type { FormSpecification } from "../types";

// IMPORTANT: 1065 line numbers changed between years.
// 2021/2022: OBI = Line 22, Total Deductions = Line 21
// 2023/2024: OBI = Line 23, Total Deductions = Line 22
// Each year gets its own spec. The extractor must select the right one.

export const FORM_1065_2022: FormSpecification = {
  formType: "FORM_1065",
  taxYear: 2022,
  version: 1,
  description: "U.S. Return of Partnership Income — 2022",
  softwareVariants: ["ProConnect", "UltraTax", "Lacerte", "Drake", "TaxSlayer Pro", "ProSeries"],
  fields: [
    {
      canonicalKey: "GROSS_RECEIPTS",
      lineNumbers: ["1a", "1c"],
      label: "Gross receipts or sales",
      labelVariants: ["Gross receipts", "Total receipts", "Revenue"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "COST_OF_GOODS_SOLD",
      lineNumbers: ["2"],
      label: "Cost of goods sold",
      labelVariants: ["COGS", "Cost of sales"],
      requiredForValidation: false,
      nullAsZero: true,  // Service businesses have no COGS — null = 0
      isEbitdaAddBack: false,
      notes: "Attach Form 1125-A. May be zero for service businesses. Interest expense may be embedded here for certain industries (maritime, construction).",
    },
    {
      canonicalKey: "GROSS_PROFIT",
      lineNumbers: ["3"],
      label: "Gross profit",
      labelVariants: ["Gross profit"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
      notes: "Computed: Line 1c - Line 2. Extract directly and verify against computation.",
    },
    {
      canonicalKey: "TOTAL_INCOME",
      lineNumbers: ["8"],
      label: "Total income (loss)",
      labelVariants: ["Total income", "Net income"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "SALARIES_WAGES",
      lineNumbers: ["9"],
      label: "Salaries and wages (other than to partners)",
      labelVariants: ["Wages", "Salaries", "Payroll"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "GUARANTEED_PAYMENTS",
      lineNumbers: ["10"],
      label: "Guaranteed payments to partners",
      labelVariants: ["Guaranteed payments"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
      notes: "Add back for EBITDA — equivalent to officer compensation in a partnership.",
    },
    {
      canonicalKey: "REPAIRS_MAINTENANCE",
      lineNumbers: ["11"],
      label: "Repairs and maintenance",
      labelVariants: ["Repairs", "Maintenance"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "RENT_EXPENSE",
      lineNumbers: ["13"],
      label: "Rent",
      labelVariants: ["Rent expense", "Lease expense"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "TAXES_LICENSES",
      lineNumbers: ["14"],
      label: "Taxes and licenses",
      labelVariants: ["Taxes", "Taxes and licenses"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "INTEREST_EXPENSE",
      lineNumbers: ["15"],
      label: "Interest",
      labelVariants: ["Interest expense", "Interest paid"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
      notes: "CRITICAL: May also appear in Form 1125-A (COGS) for certain industries. Extractor must check both locations and sum if both present.",
    },
    {
      canonicalKey: "DEPRECIATION",
      lineNumbers: ["16c"],
      label: "Depreciation",
      labelVariants: ["Depreciation", "Depr"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
      notes: "Net of depreciation reported on Form 1125-A. See also Form 4562 for detail.",
    },
    {
      canonicalKey: "SECTION_179_EXPENSE",
      lineNumbers: [],
      label: "Section 179 expense deduction",
      labelVariants: ["Sec 179", "Section 179"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
      notes: "Reported on Schedule K Line 12, not page 1. Must be pulled from Schedule K. Add back for EBITDA.",
    },
    {
      canonicalKey: "OTHER_DEDUCTIONS",
      lineNumbers: ["20"],
      label: "Other deductions",
      labelVariants: ["Other deductions", "Other expenses"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Attachment required. Extractor must parse continuation statement for line items.",
    },
    {
      canonicalKey: "TOTAL_DEDUCTIONS",
      lineNumbers: ["21"],
      label: "Total deductions",
      labelVariants: ["Total deductions", "Total expenses"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "ORDINARY_BUSINESS_INCOME",
      lineNumbers: ["22"],
      label: "Ordinary business income (loss)",
      labelVariants: ["Ordinary business income", "OBI", "Net income"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
      notes: "Line 22 in 2022. Becomes Line 23 in 2024.",
    },
  ],
  identityChecks: [
    {
      id: "1065_2022_GROSS_PROFIT",
      description: "Gross Receipts - COGS = Gross Profit (Line 1c - Line 2 = Line 3)",
      lhs: ["GROSS_RECEIPTS"],
      rhs: ["COST_OF_GOODS_SOLD", "GROSS_PROFIT"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      sourceDescription: "Form 1065 Page 1, Lines 1c, 2, 3",
    },
    {
      id: "1065_2022_OBI",
      description: "Total Income - Total Deductions = OBI (Line 8 - Line 21 = Line 22)",
      lhs: ["TOTAL_INCOME"],
      rhs: ["TOTAL_DEDUCTIONS", "ORDINARY_BUSINESS_INCOME"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      sourceDescription: "Form 1065 Page 1, Lines 8, 21, 22",
    },
    {
      id: "1065_2022_BALANCE_SHEET",
      description: "Total Assets = Total Liabilities + Partners Capital",
      lhs: ["TOTAL_ASSETS"],
      rhs: ["TOTAL_LIABILITIES", "TOTAL_EQUITY"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: false,  // Schedule L may not be required for small partnerships
      sourceDescription: "Form 1065 Schedule L",
    },
  ],
  ebitdaAddBackKeys: [
    "INTEREST_EXPENSE",
    "DEPRECIATION",
    "AMORTIZATION",
    "SECTION_179_EXPENSE",
    "GUARANTEED_PAYMENTS",
  ],
};

// 2024 spec — OBI moved to Line 23, Total Deductions to Line 22
export const FORM_1065_2024: FormSpecification = {
  ...FORM_1065_2022,
  taxYear: 2024,
  version: 1,
  description: "U.S. Return of Partnership Income — 2024",
  fields: FORM_1065_2022.fields.map(f => {
    if (f.canonicalKey === "TOTAL_DEDUCTIONS") {
      return { ...f, lineNumbers: ["22"], notes: "Line 22 in 2024 (was Line 21 in 2022)" };
    }
    if (f.canonicalKey === "ORDINARY_BUSINESS_INCOME") {
      return { ...f, lineNumbers: ["23"], notes: "Line 23 in 2024 (was Line 22 in 2022)" };
    }
    return f;
  }),
  identityChecks: [
    FORM_1065_2022.identityChecks[0], // gross profit check unchanged
    {
      id: "1065_2024_OBI",
      description: "Total Income - Total Deductions = OBI (Line 8 - Line 22 = Line 23)",
      lhs: ["TOTAL_INCOME"],
      rhs: ["TOTAL_DEDUCTIONS", "ORDINARY_BUSINESS_INCOME"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      sourceDescription: "Form 1065 Page 1, Lines 8, 22, 23",
    },
    FORM_1065_2022.identityChecks[2], // balance sheet check unchanged
  ],
};

// 2021 spec — same as 2022
export const FORM_1065_2021: FormSpecification = {
  ...FORM_1065_2022,
  taxYear: 2021,
  description: "U.S. Return of Partnership Income — 2021",
};

// 2023 spec — same line numbers as 2024
export const FORM_1065_2023: FormSpecification = {
  ...FORM_1065_2024,
  taxYear: 2023,
  description: "U.S. Return of Partnership Income — 2023",
};

export const FORM_1065_SPECS: Record<number, FormSpecification> = {
  2021: FORM_1065_2021,
  2022: FORM_1065_2022,
  2023: FORM_1065_2023,
  2024: FORM_1065_2024,
};

export function getForm1065Spec(taxYear: number): FormSpecification {
  return FORM_1065_SPECS[taxYear] ?? FORM_1065_SPECS[2024];
}
```

---

### FILE 3: `src/lib/irsKnowledge/formSpecs/form1120.ts`

Form 1120 and 1120S specifications for C-Corps and S-Corps.

```typescript
import type { FormSpecification } from "../types";

export const FORM_1120_2022: FormSpecification = {
  formType: "FORM_1120",
  taxYear: 2022,
  version: 1,
  description: "U.S. Corporation Income Tax Return — 2022",
  softwareVariants: ["ProConnect", "UltraTax", "Lacerte", "Drake"],
  fields: [
    {
      canonicalKey: "GROSS_RECEIPTS",
      lineNumbers: ["1a", "1c"],
      label: "Gross receipts or sales",
      labelVariants: ["Gross receipts", "Net revenue"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "COST_OF_GOODS_SOLD",
      lineNumbers: ["2"],
      label: "Cost of goods sold",
      labelVariants: ["COGS"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "GROSS_PROFIT",
      lineNumbers: ["3"],
      label: "Gross profit",
      labelVariants: ["Gross profit"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "OFFICER_COMPENSATION",
      lineNumbers: ["12"],
      label: "Compensation of officers",
      labelVariants: ["Officer compensation", "Officer salaries"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Key add-back consideration for closely-held C-corps. Market rate adjustment may be needed.",
    },
    {
      canonicalKey: "SALARIES_WAGES",
      lineNumbers: ["13"],
      label: "Salaries and wages",
      labelVariants: ["Wages", "Salaries"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "INTEREST_EXPENSE",
      lineNumbers: ["23"],
      label: "Interest",
      labelVariants: ["Interest expense"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
    },
    {
      canonicalKey: "DEPRECIATION",
      lineNumbers: ["20"],
      label: "Depreciation",
      labelVariants: ["Depreciation"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
    },
    {
      canonicalKey: "TOTAL_DEDUCTIONS",
      lineNumbers: ["28"],
      label: "Total deductions",
      labelVariants: ["Total deductions"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "TAXABLE_INCOME",
      lineNumbers: ["30"],
      label: "Taxable income",
      labelVariants: ["Taxable income", "Net income before tax"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
  ],
  identityChecks: [
    {
      id: "1120_GROSS_PROFIT",
      description: "Gross Receipts - COGS = Gross Profit",
      lhs: ["GROSS_RECEIPTS"],
      rhs: ["COST_OF_GOODS_SOLD", "GROSS_PROFIT"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      sourceDescription: "Form 1120 Lines 1c, 2, 3",
    },
    {
      id: "1120_TAXABLE_INCOME",
      description: "Total Income - Total Deductions = Taxable Income",
      lhs: ["TOTAL_INCOME"],
      rhs: ["TOTAL_DEDUCTIONS", "TAXABLE_INCOME"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      sourceDescription: "Form 1120 Lines 11, 28, 30",
    },
    {
      id: "1120_BALANCE_SHEET",
      description: "Total Assets = Total Liabilities + Total Equity",
      lhs: ["TOTAL_ASSETS"],
      rhs: ["TOTAL_LIABILITIES", "TOTAL_EQUITY"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: false,
      sourceDescription: "Form 1120 Schedule L",
    },
  ],
  ebitdaAddBackKeys: [
    "INTEREST_EXPENSE",
    "DEPRECIATION",
    "AMORTIZATION",
    "SECTION_179_EXPENSE",
  ],
};

export const FORM_1120S_2022: FormSpecification = {
  ...FORM_1120_2022,
  formType: "FORM_1120S",
  description: "U.S. Income Tax Return for an S Corporation — 2022",
  fields: [
    ...FORM_1120_2022.fields,
    {
      canonicalKey: "ORDINARY_BUSINESS_INCOME",
      lineNumbers: ["21"],
      label: "Ordinary business income (loss)",
      labelVariants: ["Ordinary income", "OBI"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
  ],
  identityChecks: [
    FORM_1120_2022.identityChecks[0],
    {
      id: "1120S_OBI",
      description: "Total Income - Total Deductions = OBI",
      lhs: ["TOTAL_INCOME"],
      rhs: ["TOTAL_DEDUCTIONS", "ORDINARY_BUSINESS_INCOME"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      sourceDescription: "Form 1120S Lines 6, 20, 21",
    },
    FORM_1120_2022.identityChecks[2],
  ],
};

export function getForm1120Spec(taxYear: number): FormSpecification {
  return { ...FORM_1120_2022, taxYear };
}

export function getForm1120SSpec(taxYear: number): FormSpecification {
  return { ...FORM_1120S_2022, taxYear };
}
```

---

### FILE 4: `src/lib/irsKnowledge/formSpecs/scheduleC.ts`

Schedule C for sole proprietors — critical for personal financial statement global cash flow.

```typescript
import type { FormSpecification } from "../types";

export const SCHEDULE_C_2022: FormSpecification = {
  formType: "SCHEDULE_C",
  taxYear: 2022,
  version: 1,
  description: "Profit or Loss From Business (Sole Proprietorship) — 2022",
  softwareVariants: ["TurboTax", "H&R Block", "ProConnect", "Drake", "TaxAct"],
  fields: [
    {
      canonicalKey: "GROSS_RECEIPTS",
      lineNumbers: ["1"],
      label: "Gross receipts or sales",
      labelVariants: ["Gross receipts", "Revenue", "Sales"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "COST_OF_GOODS_SOLD",
      lineNumbers: ["4"],
      label: "Cost of goods sold",
      labelVariants: ["COGS"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "GROSS_PROFIT",
      lineNumbers: ["5"],
      label: "Gross profit",
      labelVariants: ["Gross profit"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "DEPRECIATION",
      lineNumbers: ["13"],
      label: "Depreciation and section 179 expense deduction",
      labelVariants: ["Depreciation", "Depr & amort"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
      notes: "Includes Section 179 on Schedule C. No separate line for 179.",
    },
    {
      canonicalKey: "INTEREST_EXPENSE",
      lineNumbers: ["16b"],
      label: "Interest (mortgage paid to banks)",
      labelVariants: ["Interest", "Interest expense"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
    },
    {
      canonicalKey: "RENT_EXPENSE",
      lineNumbers: ["20b"],
      label: "Rent or lease (other business property)",
      labelVariants: ["Rent", "Lease"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "OTHER_DEDUCTIONS",
      lineNumbers: ["48"],
      label: "Other expenses",
      labelVariants: ["Other expenses", "Other deductions"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "TOTAL_DEDUCTIONS",
      lineNumbers: ["28"],
      label: "Total expenses before expenses for business use of home",
      labelVariants: ["Total expenses"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "NET_PROFIT",
      lineNumbers: ["31"],
      label: "Net profit or (loss)",
      labelVariants: ["Net profit", "Net loss", "Net income"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
  ],
  identityChecks: [
    {
      id: "SCHC_GROSS_PROFIT",
      description: "Gross Receipts - COGS = Gross Profit",
      lhs: ["GROSS_RECEIPTS"],
      rhs: ["COST_OF_GOODS_SOLD", "GROSS_PROFIT"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      sourceDescription: "Schedule C Lines 1, 4, 5",
    },
    {
      id: "SCHC_NET_PROFIT",
      description: "Gross Profit - Total Expenses = Net Profit",
      lhs: ["GROSS_PROFIT"],
      rhs: ["TOTAL_DEDUCTIONS", "NET_PROFIT"],
      operator: "=",
      toleranceDollars: 5,  // Home office, meals, and other partial deductions create minor rounding
      requiredForValidation: true,
      sourceDescription: "Schedule C Lines 5, 28, 31",
    },
  ],
  ebitdaAddBackKeys: ["INTEREST_EXPENSE", "DEPRECIATION", "AMORTIZATION"],
};

export function getScheduleCSpec(taxYear: number): FormSpecification {
  return { ...SCHEDULE_C_2022, taxYear };
}
```

---

### FILE 5: `src/lib/irsKnowledge/identityValidator.ts`

The IRS Identity Validation Engine. Runs after every extraction.
Returns VERIFIED / FLAGGED / BLOCKED with full audit trail.

```typescript
import "server-only";
import type {
  CanonicalFactKey,
  DocumentValidationResult,
  FormSpecification,
  IdentityCheckResult,
  ValidationStatus,
} from "./types";

type FactMap = Record<string, number | null>;

function sumKeys(keys: CanonicalFactKey[], facts: FactMap): {
  value: number | null;
  missingKeys: string[];
} {
  let total = 0;
  const missingKeys: string[] = [];

  for (const key of keys) {
    const v = facts[key];
    if (v === null || v === undefined) {
      missingKeys.push(key);
    } else {
      total += v;
    }
  }

  // If any required key is missing, the sum is unusable
  return missingKeys.length > 0
    ? { value: null, missingKeys }
    : { value: total, missingKeys: [] };
}

function runIdentityCheck(
  check: FormSpecification["identityChecks"][0],
  facts: FactMap,
): IdentityCheckResult {
  const lhs = sumKeys(check.lhs as CanonicalFactKey[], facts);
  const rhs = sumKeys(check.rhs as CanonicalFactKey[], facts);

  // Skip if inputs are missing
  if (lhs.value === null || rhs.value === null) {
    const missing = [...lhs.missingKeys, ...rhs.missingKeys];
    return {
      checkId: check.id,
      description: check.description,
      lhsValue: lhs.value,
      rhsValue: rhs.value,
      delta: null,
      toleranceDollars: check.toleranceDollars,
      passed: false,
      skipped: true,
      skipReason: `Missing facts: ${missing.join(", ")}`,
    };
  }

  const delta = Math.abs(lhs.value - rhs.value);
  const passed = delta <= check.toleranceDollars;

  return {
    checkId: check.id,
    description: check.description,
    lhsValue: lhs.value,
    rhsValue: rhs.value,
    delta,
    toleranceDollars: check.toleranceDollars,
    passed,
    skipped: false,
  };
}

function determineStatus(results: IdentityCheckResult[], spec: FormSpecification): ValidationStatus {
  const required = spec.identityChecks.filter(c => c.requiredForValidation);
  const requiredResults = results.filter(r =>
    required.some(c => c.id === r.checkId)
  );

  const requiredFailed = requiredResults.filter(r => !r.skipped && !r.passed);
  const requiredPassed = requiredResults.filter(r => !r.skipped && r.passed);
  const requiredSkipped = requiredResults.filter(r => r.skipped);

  // All required checks failed — block
  if (requiredFailed.length > 0 && requiredPassed.length === 0) {
    return "BLOCKED";
  }

  // Some required checks failed — flag for analyst
  if (requiredFailed.length > 0) {
    return "FLAGGED";
  }

  // All skipped — can't verify
  if (requiredSkipped.length === required.length) {
    return "PARTIAL";
  }

  // All required passed
  return "VERIFIED";
}

function buildSummary(
  status: ValidationStatus,
  results: IdentityCheckResult[],
): string {
  const failed = results.filter(r => !r.skipped && !r.passed);
  const passed = results.filter(r => !r.skipped && r.passed);
  const skipped = results.filter(r => r.skipped);

  if (status === "VERIFIED") {
    return `All ${passed.length} identity checks passed. Extraction verified.`;
  }

  if (status === "BLOCKED") {
    const details = failed
      .map(r => `${r.checkId}: delta $${r.delta?.toFixed(0)} exceeds tolerance $${r.toleranceDollars}`)
      .join("; ");
    return `${failed.length} identity check(s) FAILED — spread blocked. ${details}`;
  }

  if (status === "FLAGGED") {
    const details = failed
      .map(r => `${r.checkId}: delta $${r.delta?.toFixed(0)}`)
      .join("; ");
    return `${passed.length} checks passed, ${failed.length} failed — analyst review required. ${details}`;
  }

  return `${passed.length} checks passed, ${skipped.length} skipped (missing facts). Partial verification.`;
}

/**
 * Validate extracted financial facts against IRS accounting identities.
 *
 * This is the primary accuracy gate. Run after every extraction.
 * Results feed into Aegis findings and spread generation gating.
 *
 * @param documentId - UUID of the source document
 * @param spec - FormSpecification for this document type and year
 * @param facts - Extracted fact map (canonical key → numeric value)
 * @returns Full validation result with audit trail
 */
export function validateDocumentFacts(
  documentId: string,
  spec: FormSpecification,
  facts: FactMap,
): DocumentValidationResult {
  const checkResults = spec.identityChecks.map(check =>
    runIdentityCheck(check, facts)
  );

  const status = determineStatus(checkResults, spec);
  const summary = buildSummary(status, checkResults);

  return {
    documentId,
    formType: spec.formType,
    taxYear: spec.taxYear,
    status,
    checkResults,
    passedCount: checkResults.filter(r => !r.skipped && r.passed).length,
    failedCount: checkResults.filter(r => !r.skipped && !r.passed).length,
    skippedCount: checkResults.filter(r => r.skipped).length,
    summary,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Determine whether spread generation is allowed given validation results.
 *
 * Policy:
 *   VERIFIED  → allow
 *   PARTIAL   → allow with warning
 *   FLAGGED   → allow with analyst sign-off requirement
 *   BLOCKED   → do not allow
 */
export function isSpreadGenerationAllowed(
  validationResults: DocumentValidationResult[],
): { allowed: boolean; requiresAnalystSignOff: boolean; reason: string } {
  const blocked = validationResults.filter(r => r.status === "BLOCKED");
  const flagged = validationResults.filter(r => r.status === "FLAGGED");

  if (blocked.length > 0) {
    return {
      allowed: false,
      requiresAnalystSignOff: false,
      reason: `${blocked.length} document(s) failed IRS identity validation. Correct extraction before proceeding.`,
    };
  }

  if (flagged.length > 0) {
    return {
      allowed: true,
      requiresAnalystSignOff: true,
      reason: `${flagged.length} document(s) require analyst verification before distribution.`,
    };
  }

  return {
    allowed: true,
    requiresAnalystSignOff: false,
    reason: "All documents verified.",
  };
}
```

---

### FILE 6: `src/lib/irsKnowledge/index.ts`

Barrel export for the knowledge base.

```typescript
export * from "./types";
export * from "./identityValidator";
export { getForm1065Spec, FORM_1065_SPECS } from "./formSpecs/form1065";
export { getForm1120Spec, getForm1120SSpec } from "./formSpecs/form1120";
export { getScheduleCSpec } from "./formSpecs/scheduleC";

export function getFormSpec(
  formType: import("./types").IrsFormType,
  taxYear: number,
): import("./types").FormSpecification | null {
  const { getForm1065Spec } = require("./formSpecs/form1065");
  const { getForm1120Spec, getForm1120SSpec } = require("./formSpecs/form1120");
  const { getScheduleCSpec } = require("./formSpecs/scheduleC");

  switch (formType) {
    case "FORM_1065": return getForm1065Spec(taxYear);
    case "FORM_1120": return getForm1120Spec(taxYear);
    case "FORM_1120S": return getForm1120SSpec(taxYear);
    case "SCHEDULE_C": return getScheduleCSpec(taxYear);
    default: return null;
  }
}
```

---

## Integration Points (Do Not Build Yet — Phase 2)

After this PR is merged, the following files will need to call the validator:

1. `src/lib/extraction/postExtractValidator.ts` — call `validateDocumentFacts()` after every extraction job
2. `src/lib/financialSpreads/spreadGate.ts` — call `isSpreadGenerationAllowed()` before rendering
3. `src/lib/aegis/findings.ts` — write `EXTRACTION_IDENTITY_CHECK_FAILED` findings when status is FLAGGED or BLOCKED
4. `src/app/api/deals/[dealId]/spreads/standard/route.ts` — enforce gate before returning spread data

These integrations are Phase 2. This PR is Phase 1 — the knowledge base itself.

---

## Tests Required

Create `src/lib/irsKnowledge/__tests__/identityValidator.test.ts`

```typescript
// Test 1: 2022 1065 — all checks pass
// Facts: GROSS_RECEIPTS=797989, COST_OF_GOODS_SOLD=0, GROSS_PROFIT=797989,
//        TOTAL_INCOME=797989, TOTAL_DEDUCTIONS=472077, ORDINARY_BUSINESS_INCOME=325912
// Expected: status = VERIFIED

// Test 2: 2024 1065 — all checks pass
// Facts: GROSS_RECEIPTS=1502871, COST_OF_GOODS_SOLD=449671, GROSS_PROFIT=1053200,
//        TOTAL_INCOME=1053200, TOTAL_DEDUCTIONS=783384, ORDINARY_BUSINESS_INCOME=269816
// Expected: status = VERIFIED

// Test 3: Extraction error — wrong revenue
// Facts: GROSS_RECEIPTS=269816 (OBI used as revenue — the bug we found),
//        COST_OF_GOODS_SOLD=449671, GROSS_PROFIT=???
// Expected: status = BLOCKED (gross profit check fails)

// Test 4: Missing COGS (service business — null = valid)
// Facts: GROSS_RECEIPTS=500000, COST_OF_GOODS_SOLD=null, GROSS_PROFIT=500000
// Expected: status = VERIFIED (COGS null treated as 0)

// Test 5: Balance sheet check with missing Schedule L
// Facts: no TOTAL_ASSETS, no TOTAL_LIABILITIES
// Expected: balance sheet check SKIPPED, other checks pass → status = VERIFIED
```

---

## Acceptance Criteria

- [ ] All 6 files compile with `tsc --noEmit`
- [ ] Tests pass: `pnpm test irsKnowledge`
- [ ] Test 3 explicitly catches the OBI-as-revenue bug we found in production
- [ ] No changes to existing spread rendering — this is additive only
- [ ] PR title: `feat: IRS Knowledge Base — domain intelligence foundation (Phase 1)`
