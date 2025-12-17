// src/lib/finance/tax/irs1120sTypes.ts

export type Irs1120SNormalized = {
  tax_year: number | null;

  // Core income statement-ish
  gross_receipts: number | null;        // line 1a (if present)
  returns_allowances: number | null;    // line 1b (if present)
  net_receipts: number | null;          // line 1c (if present)

  cogs: number | null;                  // line 2
  gross_profit: number | null;          // line 3

  total_income: number | null;          // line 6
  total_deductions: number | null;      // line 19
  ordinary_business_income: number | null; // line 21 (key)

  // Common addbacks / discretionary (best-effort)
  officer_comp: number | null;          // line 7
  wages: number | null;                 // line 8
  repairs: number | null;               // line 9
  bad_debts: number | null;             // line 10
  rents: number | null;                 // line 11
  taxes_licenses: number | null;        // line 12
  interest: number | null;              // line 13
  depreciation: number | null;          // line 14
  advertising: number | null;           // line 16
  pension: number | null;               // line 17
  employee_benefits: number | null;     // line 18
  meals: number | null;                 // often embedded; heuristic
  travel: number | null;                // heuristic

  // Underwriting outputs (v1)
  ebitda_proxy: number | null;
  cfads_proxy: number | null;

  confidence: number; // 0..1
  notes?: string[];
};