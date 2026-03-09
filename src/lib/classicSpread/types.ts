export type StatementPeriod = {
  date: string; // "12/31/2023"
  months: number; // 12
  auditMethod: string; // "Tax Return" | "Reviewed" | "Audited" | "Compiled" | "Unaudited"
  stmtType: string; // "Annual" | "Interim"
  label: string; // "2023" | "YTD 2025"
};

export type FinancialRow = {
  label: string;
  indent: number; // 0 = section header, 1 = line item, 2 = sub-item
  isBold: boolean;
  values: (number | null)[]; // one per period, in period order
  showPct: boolean; // whether to show % column alongside value
  pctBase?: (number | null)[]; // denominator for % calc (usually revenue for IS, total assets for BS)
  isNegative?: boolean; // display in parentheses when positive (e.g. accumulated depreciation)
};

export type CashFlowRow = {
  label: string;
  indent: number; // 0 = section header, 1 = line item, 2 = sub-item
  isBold: boolean;
  values: (number | null)[]; // one per period
  isNegative?: boolean;
};

export type RatioRow = {
  label: string;
  values: (number | string | null)[]; // "N/A" allowed
  format: "number" | "percent" | "ratio" | "days" | "currency";
  decimals: number;
};

export type RatioSection = {
  title: string; // "LIQUIDITY" | "LEVERAGE" | etc.
  rows: RatioRow[];
};

export type ClassicSpreadInput = {
  // Deal metadata
  dealId: string;
  companyName: string;
  preparedDate: string; // "1:22 PM, 6/10/2024" format
  naicsCode: string | null;
  naicsDescription: string | null;
  bankName: string;

  // Periods (chronological order)
  periods: StatementPeriod[];

  // Financial statements
  balanceSheet: FinancialRow[];
  incomeStatement: FinancialRow[];

  // Cash flow (UCA indirect method)
  cashFlow: CashFlowRow[];
  cashFlowPeriods: StatementPeriod[];

  // Ratios
  ratioSections: RatioSection[];

  // Executive summary (combined BS + IS condensed)
  executiveSummary: {
    assets: FinancialRow[];
    liabilitiesAndNetWorth: FinancialRow[];
    incomeStatement: FinancialRow[];
  };
};
