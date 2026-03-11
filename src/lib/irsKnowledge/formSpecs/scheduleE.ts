import type { FormSpecification } from "../types";

// Schedule E: Supplemental Income and Loss
// Part I: Rental Real Estate and Royalties (per-property)
// Part II: Partnership and S-Corp income (K-1 pass-through)
//
// CRITICAL distinction: Part II shows the share of entity income.
// The canonical K1_ORDINARY_INCOME key maps to Part II totals.

const SCHEDULE_E_BASE: Omit<FormSpecification, "taxYear" | "description"> = {
  formType: "SCHEDULE_E",
  version: 1,
  softwareVariants: [
    "TurboTax", "H&R Block", "TaxAct", "FreeTaxUSA",
    "ProConnect", "Lacerte", "UltraTax", "Drake"
  ],
  fields: [
    {
      canonicalKey: "SCH_E_RENTS_RECEIVED",
      lineNumbers: ["3"],
      label: "Rents received (all properties)",
      labelVariants: ["Rents received", "Gross rents", "Total rents"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Column A/B/C Line 3 total across all properties.",
    },
    {
      canonicalKey: "SCH_E_MORTGAGE_INTEREST",
      lineNumbers: ["12"],
      label: "Mortgage interest paid",
      labelVariants: ["Mortgage interest", "Mortgage interest paid"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "SCH_E_DEPRECIATION",
      lineNumbers: ["18"],
      label: "Depreciation expense",
      labelVariants: ["Depreciation", "Depreciation expense or depletion"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: true,
      notes: "Add back for EBITDA on rental properties.",
    },
    {
      canonicalKey: "SCH_E_RENTAL_TOTAL",
      lineNumbers: ["26", "24"],
      label: "Total rental real estate and royalty income (loss)",
      labelVariants: ["Total rental income", "Net rental income", "Schedule E total"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
      notes: "Line 26 (2022–2024) / Line 24 (2021). Net after all expenses.",
    },
    {
      canonicalKey: "K1_ORDINARY_INCOME",
      lineNumbers: ["32", "33", "34"],
      label: "Net income (loss) from partnerships and S-corporations (Part II)",
      labelVariants: ["Partnership income", "S-corp income", "Passive income", "Nonpassive income"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Sum of Column G (passive income) + Column J (nonpassive income) from Part II.",
    },
    {
      canonicalKey: "SCH_E_NET_PER_PROPERTY",
      lineNumbers: ["24a", "24b", "24c"],
      label: "Income (loss) per rental property",
      labelVariants: ["Net income per property"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "Per-property net. Sum = SCH_E_RENTAL_TOTAL. Stored as array — extract as aggregate.",
    },
    {
      canonicalKey: "SCH_E_PASSIVE_LOSS",
      lineNumbers: ["22"],
      label: "Deductible rental real estate loss",
      labelVariants: ["Passive loss", "Rental loss", "Deductible rental loss"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
      notes: "PAL limitations apply. Negative number if loss.",
    },
    {
      canonicalKey: "SCH_E_NONPASSIVE_INCOME",
      lineNumbers: [""],
      label: "Nonpassive income from partnerships/S-corps (Part II)",
      labelVariants: ["Nonpassive income", "Non-passive income"],
      requiredForValidation: false,
      nullAsZero: true,
      isEbitdaAddBack: false,
    },
  ],
  identityChecks: [
    {
      id: "SCH_E_RENTAL_NET",
      description: "Rents Received - Total Expenses ≈ Net Rental Income (approximate — many expense lines not individually captured)",
      lhs: ["SCH_E_RENTS_RECEIVED"],
      rhs: ["SCH_E_RENTAL_TOTAL", "SCH_E_MORTGAGE_INTEREST", "SCH_E_DEPRECIATION"],
      operator: "≈",
      toleranceDollars: 50000,
      requiredForValidation: false,
      sourceDescription: "Schedule E Part I — Lines 3, 12, 18, 26",
    },
  ],
  ebitdaAddBackKeys: ["SCH_E_DEPRECIATION"],
};

export const SCHEDULE_E_2021: FormSpecification = {
  ...SCHEDULE_E_BASE,
  taxYear: 2021,
  description: "Schedule E — Supplemental Income and Loss — 2021",
};
export const SCHEDULE_E_2022: FormSpecification = {
  ...SCHEDULE_E_BASE,
  taxYear: 2022,
  description: "Schedule E — Supplemental Income and Loss — 2022",
};
export const SCHEDULE_E_2023: FormSpecification = {
  ...SCHEDULE_E_BASE,
  taxYear: 2023,
  description: "Schedule E — Supplemental Income and Loss — 2023",
};
export const SCHEDULE_E_2024: FormSpecification = {
  ...SCHEDULE_E_BASE,
  taxYear: 2024,
  description: "Schedule E — Supplemental Income and Loss — 2024",
};

export const SCHEDULE_E_SPECS: Record<number, FormSpecification> = {
  2021: SCHEDULE_E_2021,
  2022: SCHEDULE_E_2022,
  2023: SCHEDULE_E_2023,
  2024: SCHEDULE_E_2024,
};

export function getScheduleESpec(taxYear: number): FormSpecification {
  return SCHEDULE_E_SPECS[taxYear] ?? SCHEDULE_E_SPECS[2024];
}
