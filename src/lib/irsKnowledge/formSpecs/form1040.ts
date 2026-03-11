import type { FormSpecification } from "../types";

// Form 1040 line numbers are stable across 2021–2024 for major income lines.
// Above-the-line deductions (Schedule 1, Part II) and credits vary by year —
// we focus on income lines which are required for underwriting.

const FORM_1040_BASE: Omit<FormSpecification, "taxYear" | "description"> = {
  formType: "FORM_1040",
  version: 1,
  softwareVariants: [
    "TurboTax", "H&R Block", "TaxAct", "FreeTaxUSA",
    "ProConnect", "Lacerte", "UltraTax", "Drake"
  ],
  fields: [
    {
      canonicalKey: "W2_WAGES",
      lineNumbers: ["1a", "1z"],
      label: "Wages, salaries, tips, etc.",
      labelVariants: ["W2 wages", "Wages and salaries", "Total wages"],
      requiredForValidation: true,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Line 1a: box 1 wages. Line 1z: total if additional lines used. Use higher of the two.",
    },
    {
      canonicalKey: "K1_ORDINARY_INCOME",
      lineNumbers: [""],
      label: "Ordinary income from K-1 (Schedule E Part II)",
      labelVariants: ["Partnership income", "S-corp income", "K-1 income"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Flows from Schedule E Part II. Extract from Schedule E, not 1040 summary line.",
    },
    {
      canonicalKey: "SCH_E_RENTAL_TOTAL",
      lineNumbers: [""],
      label: "Net rental/royalty income (Schedule E Part I total)",
      labelVariants: ["Rental income", "Schedule E net"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Net income from all rental/royalty properties. From Schedule E summary.",
    },
    {
      canonicalKey: "SCH_C_NET_PROFIT",
      lineNumbers: [""],
      label: "Net profit from Schedule C",
      labelVariants: ["Schedule C net profit", "Business profit"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Self-employment / sole proprietor income. From Schedule C Line 31.",
    },
    {
      canonicalKey: "TOTAL_INCOME",
      lineNumbers: ["9"],
      label: "Total income",
      labelVariants: ["Total income"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
      notes: "Line 9 on Form 1040. Sum of all income lines.",
    },
    {
      canonicalKey: "TAXABLE_INCOME",
      lineNumbers: ["15"],
      label: "Taxable income",
      labelVariants: ["Taxable income"],
      requiredForValidation: false,
      nullAsZero: false,
      isEbitdaAddBack: false,
      notes: "Line 15. AGI minus deductions.",
    },
  ],
  identityChecks: [
    {
      id: "1040_INCOME_COMPONENTS",
      description: "Major income components (W2 + Sch E rental + K-1 + Sch C) ≈ Total Income (approximate — many small items omitted)",
      lhs: ["W2_WAGES", "SCH_E_RENTAL_TOTAL", "K1_ORDINARY_INCOME", "SCH_C_NET_PROFIT"],
      rhs: ["TOTAL_INCOME"],
      operator: "≈",
      toleranceDollars: 75000, // Large tolerance — interest, dividends, capital gains, SS, etc. not captured
      requiredForValidation: false, // Informational only — fails gracefully to PARTIAL not BLOCKED
      sourceDescription: "Form 1040 Lines 1a, 9 + Schedule E summary",
    },
  ],
  ebitdaAddBackKeys: [], // PTR is personal — no EBITDA add-backs applicable
};

export const FORM_1040_2021: FormSpecification = {
  ...FORM_1040_BASE,
  taxYear: 2021,
  description: "U.S. Individual Income Tax Return — 2021",
};

export const FORM_1040_2022: FormSpecification = {
  ...FORM_1040_BASE,
  taxYear: 2022,
  description: "U.S. Individual Income Tax Return — 2022",
};

export const FORM_1040_2023: FormSpecification = {
  ...FORM_1040_BASE,
  taxYear: 2023,
  description: "U.S. Individual Income Tax Return — 2023",
};

export const FORM_1040_2024: FormSpecification = {
  ...FORM_1040_BASE,
  taxYear: 2024,
  description: "U.S. Individual Income Tax Return — 2024",
};

export const FORM_1040_SPECS: Record<number, FormSpecification> = {
  2021: FORM_1040_2021,
  2022: FORM_1040_2022,
  2023: FORM_1040_2023,
  2024: FORM_1040_2024,
};

export function getForm1040Spec(taxYear: number): FormSpecification {
  return FORM_1040_SPECS[taxYear] ?? FORM_1040_SPECS[2024];
}
