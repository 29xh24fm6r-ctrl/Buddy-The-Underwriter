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
