/**
 * Moody's Financial Analysis (Gold Standard) — Canonical Mapping
 *
 * Fixture reference (not checked in here):
 *   /mnt/data/LTG FA Package (002).pdf
 *
 * IMPORTANT:
 * - DO NOT reorder rows.
 * - DO NOT rename labels.
 * - Every computed line must reference a named formula in formulas/registry.ts
 * - Every item must carry a source page reference to the PDF.
 */

export type MoodysStatement =
  | "BALANCE_SHEET"
  | "INCOME_STATEMENT"
  | "CASH_FLOW"
  | "RATIOS"
  | "EXEC_SUMMARY";

export type MoodysRow = {
  statement: MoodysStatement;
  section: string;
  order: number;
  label: string;
  key: string;
  formulaId?: string;
  isPercent?: boolean;
  precision?: number;
  sign?: "POSITIVE" | "PAREN_NEGATIVE";
  sourcePages: number[];
};

// ── Balance Sheet ─────────────────────────────────────────────────────────────

const BS_ASSETS: MoodysRow[] = [
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 100, label: "Cash & Cash Equivalents", key: "CASH_AND_EQUIVALENTS", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 110, label: "Accounts Receivable", key: "ACCOUNTS_RECEIVABLE", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 120, label: "Inventory", key: "INVENTORY", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 130, label: "Prepaid Expenses", key: "PREPAID_EXPENSES", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 140, label: "Other Current Assets", key: "OTHER_CURRENT_ASSETS", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 150, label: "Total Current Assets", key: "TOTAL_CURRENT_ASSETS", formulaId: "TOTAL_CURRENT_ASSETS", precision: 0, sourcePages: [1] },

  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 200, label: "Fixed Assets (Net)", key: "FIXED_ASSETS_NET", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 210, label: "Real Estate Held", key: "REAL_ESTATE_HELD", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 220, label: "Intangible Assets", key: "INTANGIBLE_ASSETS", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 230, label: "Other Non-Current Assets", key: "OTHER_NONCURRENT_ASSETS", sourcePages: [1] },

  { statement: "BALANCE_SHEET", section: "Total Assets", order: 300, label: "Total Assets", key: "TOTAL_ASSETS", formulaId: "TOTAL_ASSETS", precision: 0, sourcePages: [1] },
];

const BS_LIABILITIES: MoodysRow[] = [
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 400, label: "Accounts Payable", key: "ACCOUNTS_PAYABLE", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 410, label: "Accrued Expenses", key: "ACCRUED_EXPENSES", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 420, label: "Current Maturities of LTD", key: "CURRENT_MATURITIES_LTD", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 430, label: "Other Current Liabilities", key: "OTHER_CURRENT_LIABILITIES", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 440, label: "Total Current Liabilities", key: "TOTAL_CURRENT_LIABILITIES", formulaId: "TOTAL_CURRENT_LIABILITIES", precision: 0, sourcePages: [1] },

  { statement: "BALANCE_SHEET", section: "Long-Term Liabilities", order: 500, label: "Long Term Debt", key: "LONG_TERM_DEBT", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Long-Term Liabilities", order: 510, label: "Other Long-Term Liabilities", key: "OTHER_LT_LIABILITIES", sourcePages: [1] },

  { statement: "BALANCE_SHEET", section: "Total Liabilities", order: 600, label: "Total Liabilities", key: "TOTAL_LIABILITIES", formulaId: "TOTAL_LIABILITIES", precision: 0, sourcePages: [1] },
];

const BS_EQUITY: MoodysRow[] = [
  { statement: "BALANCE_SHEET", section: "Equity", order: 700, label: "Common Stock / Paid-in Capital", key: "COMMON_STOCK", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Equity", order: 710, label: "Retained Earnings", key: "RETAINED_EARNINGS", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Equity", order: 720, label: "Other Equity", key: "OTHER_EQUITY", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Equity", order: 730, label: "Total Equity / Net Worth", key: "NET_WORTH", formulaId: "NET_WORTH", precision: 0, sourcePages: [1] },

  { statement: "BALANCE_SHEET", section: "Check", order: 800, label: "Total Liabilities & Equity", key: "TOTAL_LIABILITIES_AND_EQUITY", formulaId: "TOTAL_LIABILITIES_AND_EQUITY", precision: 0, sourcePages: [1] },
];

// ── Income Statement ──────────────────────────────────────────────────────────

const IS_ROWS: MoodysRow[] = [
  { statement: "INCOME_STATEMENT", section: "Revenue", order: 100, label: "Gross Rental Income", key: "GROSS_RENTAL_INCOME", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Revenue", order: 110, label: "Other Income", key: "OTHER_INCOME", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Revenue", order: 120, label: "Less: Vacancy & Concessions", key: "VACANCY_CONCESSIONS", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Revenue", order: 130, label: "Total Income / Revenue", key: "TOTAL_INCOME", formulaId: "TOTAL_INCOME", precision: 0, sourcePages: [2] },

  { statement: "INCOME_STATEMENT", section: "Cost of Goods Sold", order: 200, label: "Cost of Goods Sold", key: "COGS", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Gross Profit", order: 210, label: "Gross Profit", key: "GROSS_PROFIT", formulaId: "GROSS_PROFIT", precision: 0, sourcePages: [2] },

  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 300, label: "Repairs & Maintenance", key: "REPAIRS_MAINTENANCE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 310, label: "Utilities", key: "UTILITIES", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 320, label: "Property Management", key: "PROPERTY_MANAGEMENT", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 330, label: "Real Estate Taxes", key: "REAL_ESTATE_TAXES", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 340, label: "Insurance", key: "INSURANCE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 350, label: "Payroll", key: "PAYROLL", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 360, label: "Marketing & Advertising", key: "MARKETING", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 370, label: "Professional Fees", key: "PROFESSIONAL_FEES", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 380, label: "Other Operating Expenses", key: "OTHER_OPEX", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 390, label: "Total Operating Expenses", key: "TOTAL_OPEX", formulaId: "TOTAL_OPEX", precision: 0, sourcePages: [2] },

  { statement: "INCOME_STATEMENT", section: "Operating Income", order: 400, label: "Net Operating Income (NOI)", key: "NOI", formulaId: "NOI", precision: 0, sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Income", order: 410, label: "EBITDA", key: "EBITDA", formulaId: "EBITDA_PROXY", precision: 0, sourcePages: [2] },

  { statement: "INCOME_STATEMENT", section: "Below the Line", order: 500, label: "Depreciation & Amortization", key: "DEPRECIATION_AMORTIZATION", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Below the Line", order: 510, label: "Interest Expense", key: "INTEREST_EXPENSE", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Below the Line", order: 520, label: "Other Non-Operating Income / (Expense)", key: "OTHER_NON_OPERATING", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Below the Line", order: 530, label: "Pre-Tax Income", key: "PRE_TAX_INCOME", formulaId: "PRE_TAX_INCOME", precision: 0, sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Below the Line", order: 540, label: "Tax Provision", key: "TAX_PROVISION", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Below the Line", order: 550, label: "Net Income", key: "NET_INCOME", formulaId: "NET_INCOME", precision: 0, sourcePages: [2] },

  { statement: "INCOME_STATEMENT", section: "Capital Expenditures", order: 600, label: "Replacement Reserves", key: "REPLACEMENT_RESERVES", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Capital Expenditures", order: 610, label: "CapEx", key: "CAPEX", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Capital Expenditures", order: 620, label: "Net Cash Flow Before Debt", key: "NET_CASH_FLOW_BEFORE_DEBT", formulaId: "NET_CASH_FLOW_BEFORE_DEBT", precision: 0, sourcePages: [2] },

  { statement: "INCOME_STATEMENT", section: "Debt Service", order: 700, label: "Annual Debt Service", key: "ANNUAL_DEBT_SERVICE", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Debt Service", order: 710, label: "Cash Flow After Debt Service", key: "EXCESS_CASH_FLOW", formulaId: "EXCESS_CASH_FLOW", precision: 0, sourcePages: [2] },
];

// ── Cash Flow Statement ───────────────────────────────────────────────────────

const CF_ROWS: MoodysRow[] = [
  { statement: "CASH_FLOW", section: "Cash Available", order: 100, label: "Cash Flow Available for Debt Service", key: "CASH_FLOW_AVAILABLE", formulaId: "CASH_FLOW_AVAILABLE_CALC", precision: 0, sourcePages: [3] },
  { statement: "CASH_FLOW", section: "Debt Service", order: 200, label: "Annual Debt Service", key: "CF_ANNUAL_DEBT_SERVICE", sourcePages: [3] },
  { statement: "CASH_FLOW", section: "Debt Service", order: 210, label: "Annual Debt Service (Stressed +300bps)", key: "CF_ANNUAL_DEBT_SERVICE_STRESSED", sourcePages: [3] },
  { statement: "CASH_FLOW", section: "Excess", order: 300, label: "Excess Cash Flow", key: "CF_EXCESS_CASH_FLOW", formulaId: "EXCESS_CASH_FLOW", precision: 0, sourcePages: [3] },
];

// ── Ratios ────────────────────────────────────────────────────────────────────

const RATIO_ROWS: MoodysRow[] = [
  // Liquidity
  { statement: "RATIOS", section: "Liquidity", order: 100, label: "Current Ratio", key: "R_CURRENT_RATIO", formulaId: "CURRENT_RATIO", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Liquidity", order: 110, label: "Working Capital", key: "R_WORKING_CAPITAL", formulaId: "WORKING_CAPITAL", precision: 0, sourcePages: [4] },

  // Leverage
  { statement: "RATIOS", section: "Leverage", order: 200, label: "Debt-to-Equity", key: "R_DEBT_TO_EQUITY", formulaId: "DEBT_TO_EQUITY", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Leverage", order: 210, label: "Equity Ratio", key: "R_EQUITY_RATIO", formulaId: "EQUITY_RATIO", precision: 4, isPercent: true, sourcePages: [4] },

  // Coverage
  { statement: "RATIOS", section: "Coverage", order: 300, label: "DSCR", key: "R_DSCR", formulaId: "DSCR", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Coverage", order: 310, label: "DSCR (Stressed +300bps)", key: "R_DSCR_STRESSED", formulaId: "DSCR_STRESSED_300BPS", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Coverage", order: 320, label: "Debt Yield", key: "R_DEBT_YIELD", formulaId: "DEBT_YIELD", precision: 4, isPercent: true, sourcePages: [4] },

  // Profitability
  { statement: "RATIOS", section: "Profitability", order: 400, label: "Gross Margin", key: "R_GROSS_MARGIN", formulaId: "GROSS_MARGIN", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 410, label: "EBITDA Margin", key: "R_EBITDA_MARGIN", formulaId: "EBITDA_MARGIN", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 420, label: "Net Margin", key: "R_NET_MARGIN", formulaId: "NET_MARGIN", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 430, label: "NOI Margin", key: "R_NOI_MARGIN", formulaId: "NOI_MARGIN", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 440, label: "Operating Expense Ratio", key: "R_OPEX_RATIO", formulaId: "OPEX_RATIO", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 450, label: "Cap Rate", key: "R_CAP_RATE", formulaId: "CAP_RATE", precision: 4, isPercent: true, sourcePages: [4] },

  // Collateral
  { statement: "RATIOS", section: "Collateral", order: 500, label: "LTV (Gross)", key: "R_LTV_GROSS", formulaId: "LTV_GROSS", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Collateral", order: 510, label: "LTV (Net)", key: "R_LTV_NET", formulaId: "LTV_NET", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Collateral", order: 520, label: "Collateral Coverage", key: "R_COLLATERAL_COVERAGE", formulaId: "COLLATERAL_COVERAGE", precision: 2, sourcePages: [4] },

  // Global Cash Flow
  { statement: "RATIOS", section: "Global Cash Flow", order: 600, label: "Global Cash Flow", key: "R_GCF", formulaId: "GCF_GLOBAL_CASH_FLOW", precision: 0, sourcePages: [4] },
  { statement: "RATIOS", section: "Global Cash Flow", order: 610, label: "Global DSCR", key: "R_GCF_DSCR", formulaId: "GCF_DSCR", precision: 2, sourcePages: [4] },
];

// ── Executive Summary (Key Metrics) ──────────────────────────────────────────

const EXEC_ROWS: MoodysRow[] = [
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 100, label: "Total Assets", key: "ES_TOTAL_ASSETS", formulaId: "TOTAL_ASSETS", precision: 0, sourcePages: [0] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 110, label: "Total Liabilities", key: "ES_TOTAL_LIABILITIES", formulaId: "TOTAL_LIABILITIES", precision: 0, sourcePages: [0] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 120, label: "Net Worth", key: "ES_NET_WORTH", formulaId: "NET_WORTH", precision: 0, sourcePages: [0] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 130, label: "Revenue / Total Income", key: "ES_REVENUE", formulaId: "REVENUE", precision: 0, sourcePages: [0] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 140, label: "NOI", key: "ES_NOI", formulaId: "NOI", precision: 0, sourcePages: [0] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 150, label: "DSCR", key: "ES_DSCR", formulaId: "DSCR", precision: 2, sourcePages: [0] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 160, label: "LTV (Gross)", key: "ES_LTV", formulaId: "LTV_GROSS", precision: 4, isPercent: true, sourcePages: [0] },
];

// ── Assembled Registry ────────────────────────────────────────────────────────

export const MOODYS_ROWS: MoodysRow[] = [
  ...BS_ASSETS,
  ...BS_LIABILITIES,
  ...BS_EQUITY,
  ...IS_ROWS,
  ...CF_ROWS,
  ...RATIO_ROWS,
  ...EXEC_ROWS,
];
