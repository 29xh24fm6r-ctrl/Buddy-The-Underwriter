// src/lib/finance/tax/taxSpreadTypes.ts

export type TaxSpread = {
  tax_year: number | null;

  revenue: number | null;
  cogs: number | null;
  gross_profit: number | null;

  operating_expenses: number | null;
  ebitda: number | null;

  interest: number | null;
  depreciation: number | null;
  amortization: number | null;

  net_income: number | null;

  // 1120S extras
  officer_comp: number | null;
  cfads_proxy: number | null;

  // metadata
  confidence: number; // 0..1
  notes?: string[];
};