// src/lib/finance/types.ts

export type Money = number;
export type Pct = number; // 0..100
export type Ratio = number;

export type PeriodKey = string;

export type StatementMeta = {
  period: PeriodKey;
  currency: "USD";
  source: "c4" | "ocr_text" | "manual";
  confidence: number; // 0..100
  notes?: string[];
};

/* ============================
   NORMALIZED STATEMENTS
   ============================ */

export type NormalizedPnl = {
  meta: StatementMeta;

  revenue: Money | null;
  cogs: Money | null;
  gross_profit: Money | null;

  operating_expenses: Money | null;

  interest_expense: Money | null;
  depreciation_amortization: Money | null;

  net_income: Money | null;

  other_income: Money | null;
  other_expense: Money | null;
};

export type NormalizedBalanceSheet = {
  meta: StatementMeta;

  cash: Money | null;
  accounts_receivable: Money | null;
  inventory: Money | null;
  other_current_assets: Money | null;

  total_current_assets: Money | null;

  fixed_assets: Money | null;
  other_assets: Money | null;

  total_assets: Money | null;

  accounts_payable: Money | null;
  accrued_expenses: Money | null;
  current_portion_ltd: Money | null;
  other_current_liabilities: Money | null;

  total_current_liabilities: Money | null;

  long_term_debt: Money | null;
  other_liabilities: Money | null;

  total_liabilities: Money | null;

  equity: Money | null;
};

export type NormalizedCashFlow = {
  meta: StatementMeta;

  net_income: Money | null;
  depreciation_amortization: Money | null;

  change_in_ar: Money | null;
  change_in_inventory: Money | null;
  change_in_ap: Money | null;
  change_in_other_working_capital: Money | null;

  cash_from_operations: Money | null;

  capex: Money | null;
  cash_from_investing: Money | null;

  debt_borrowed: Money | null;
  debt_repaid: Money | null;
  distributions: Money | null;
  cash_from_financing: Money | null;

  net_change_in_cash: Money | null;
  ending_cash: Money | null;
};

/* ============================
   MOODY METRICS
   ============================ */

export type MoodyMetricId =
  | "gross_margin_pct"
  | "opex_pct_of_sales"
  | "net_margin_pct"
  | "ebit"
  | "ebitda"
  | "ebitda_margin_pct"
  | "working_capital"
  | "current_ratio"
  | "quick_ratio"
  | "debt_to_equity"
  | "total_liabilities_to_tnw"
  | "interest_coverage_ebit"
  | "fixed_charge_coverage"
  | "dscr_global";

export type MoodyMetricValue = {
  id: MoodyMetricId;
  label: string;
  value: number | null;
  unit: "money" | "pct" | "ratio";
  formula: string;
  components?: Record<string, number | null>;
};

/* ============================
   MOODY PACKAGE (FINAL OUTPUT)
   ============================ */

export type MoodyPackage = {
  dealId: string;
  jobId: string;
  generatedAt: string;

  pnl: NormalizedPnl | null;
  bs: NormalizedBalanceSheet | null;
  cf: NormalizedCashFlow | null;

  metrics: MoodyMetricValue[];

  flags: {
    severity: "info" | "warn" | "risk";
    message: string;
  }[];
};
