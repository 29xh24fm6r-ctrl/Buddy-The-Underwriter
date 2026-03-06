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
