/**
 * Financial Analysis (Standard Spread) — MMAS Canonical Mapping
 *
 * Standard MMAS format — the layout every commercial banker in America recognizes.
 *
 * IMPORTANT:
 * - DO NOT reorder rows without coordinating with formula registry.
 * - Every computed line must reference a named formula in formulas/registry.ts.
 * - Row keys use extractor-native fact keys where possible to minimize aliasing.
 */

export type StandardStatement =
  | "BALANCE_SHEET"
  | "INCOME_STATEMENT"
  | "CASH_FLOW"
  | "RATIOS"
  | "EXEC_SUMMARY";

export type StandardRow = {
  statement: StandardStatement;
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

const BS_CURRENT_ASSETS: StandardRow[] = [
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 100, label: "Cash & Near Cash", key: "CASH_AND_EQUIVALENTS", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 110, label: "Accounts/Notes Receivable (Net)", key: "ACCOUNTS_RECEIVABLE", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 120, label: "Inventory", key: "INVENTORY", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 130, label: "Other Current Assets", key: "OTHER_CURRENT_ASSETS", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Assets", order: 150, label: "Total Current Assets", key: "TOTAL_CURRENT_ASSETS", formulaId: "TOTAL_CURRENT_ASSETS", precision: 0, sourcePages: [1] },
];

const BS_NONCURRENT_ASSETS: StandardRow[] = [
  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 200, label: "Net Fixed Assets", key: "FIXED_ASSETS_NET", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 210, label: "LT Receivables & Investments", key: "LT_RECEIVABLES", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 220, label: "Intangibles - Net", key: "INTANGIBLES_NET", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Non-Current Assets", order: 230, label: "Total Non-Current Assets", key: "TOTAL_NONCURRENT_ASSETS", formulaId: "TOTAL_NONCURRENT_ASSETS", precision: 0, sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Total Assets", order: 250, label: "Total Assets", key: "TOTAL_ASSETS", formulaId: "TOTAL_ASSETS", precision: 0, sourcePages: [1] },
];

const BS_CURRENT_LIABILITIES: StandardRow[] = [
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 300, label: "S/T Loans Payable", key: "ST_LOANS_PAYABLE", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 310, label: "Accounts Payable", key: "ACCOUNTS_PAYABLE", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 320, label: "Accrued Liabilities", key: "ACCRUED_LIABILITIES", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 330, label: "Other Current Liabilities", key: "OTHER_CURRENT_LIABILITIES", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Current Liabilities", order: 350, label: "Total Current Liabilities", key: "TOTAL_CURRENT_LIABILITIES", formulaId: "TOTAL_CURRENT_LIABILITIES", precision: 0, sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Total Liabilities", order: 360, label: "Total Liabilities", key: "TOTAL_LIABILITIES", formulaId: "TOTAL_LIABILITIES", precision: 0, sourcePages: [1] },
];

const BS_NET_WORTH: StandardRow[] = [
  { statement: "BALANCE_SHEET", section: "Net Worth", order: 400, label: "Common Stock", key: "COMMON_STOCK", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Net Worth", order: 410, label: "Paid In Capital", key: "PAID_IN_CAPITAL", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Net Worth", order: 420, label: "Retained Earnings", key: "RETAINED_EARNINGS", sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Net Worth", order: 430, label: "Total Net Worth", key: "NET_WORTH", formulaId: "NET_WORTH", precision: 0, sourcePages: [1] },
  { statement: "BALANCE_SHEET", section: "Check", order: 450, label: "Total Liabilities & Net Worth", key: "TOTAL_LIABILITIES_AND_EQUITY", formulaId: "TOTAL_LIABILITIES_AND_EQUITY", precision: 0, sourcePages: [1] },
];

// ── Income Statement ──────────────────────────────────────────────────────────

const IS_ROWS: StandardRow[] = [
  // Revenue
  { statement: "INCOME_STATEMENT", section: "Revenue", order: 100, label: "Sales / Revenues", key: "TOTAL_REVENUE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Revenue", order: 110, label: "Cost of Goods Sold", key: "COST_OF_GOODS_SOLD", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Revenue", order: 130, label: "Gross Profit", key: "GROSS_PROFIT", formulaId: "GROSS_PROFIT", precision: 0, sourcePages: [2] },

  // Operating Expenses (includes Interest per MMAS)
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 200, label: "Officers' Compensation", key: "OFFICER_COMPENSATION", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 210, label: "Personnel / Payroll Expense", key: "PAYROLL", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 220, label: "Operating Expense", key: "OPERATING_EXPENSE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 230, label: "Repairs & Maintenance", key: "REPAIRS_MAINTENANCE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 240, label: "Lease / Rent Expense", key: "RENT_EXPENSE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 250, label: "Depreciation & Amortization", key: "DEPRECIATION", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 260, label: "Interest Expense", key: "INTEREST_EXPENSE", sign: "PAREN_NEGATIVE", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 270, label: "Other Operating Expense", key: "OTHER_DEDUCTIONS", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Expenses", order: 300, label: "Total Operating Expenses", key: "TOTAL_OPERATING_EXPENSES", formulaId: "TOTAL_OPERATING_EXPENSES", precision: 0, sourcePages: [2] },

  // Operating Income
  { statement: "INCOME_STATEMENT", section: "Operating Income", order: 310, label: "Net Operating Profit", key: "NET_OPERATING_PROFIT", formulaId: "NET_OPERATING_PROFIT", precision: 0, sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Income", order: 320, label: "Other Income", key: "OTHER_INCOME", sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Operating Income", order: 330, label: "Other Expense (-)", key: "OTHER_EXPENSE", sign: "PAREN_NEGATIVE", sourcePages: [2] },

  // Bottom Line
  { statement: "INCOME_STATEMENT", section: "Bottom Line", order: 500, label: "Net Profit", key: "NET_PROFIT", formulaId: "NET_PROFIT", precision: 0, sourcePages: [2] },
  { statement: "INCOME_STATEMENT", section: "Bottom Line", order: 510, label: "EBITDA", key: "EBITDA", formulaId: "EBITDA_CALC", precision: 0, sourcePages: [2] },
];

// ── Cash Flow Statement ───────────────────────────────────────────────────────

const CF_ROWS: StandardRow[] = [
  { statement: "CASH_FLOW", section: "Cash Available", order: 100, label: "Cash Flow Available for Debt Service", key: "CASH_FLOW_AVAILABLE", formulaId: "CASH_FLOW_AVAILABLE_CALC", precision: 0, sourcePages: [3] },
  { statement: "CASH_FLOW", section: "Debt Service", order: 200, label: "Annual Debt Service", key: "CF_ANNUAL_DEBT_SERVICE", sourcePages: [3] },
  { statement: "CASH_FLOW", section: "Debt Service", order: 210, label: "Annual Debt Service (Stressed +300bps)", key: "CF_ANNUAL_DEBT_SERVICE_STRESSED", sourcePages: [3] },
  { statement: "CASH_FLOW", section: "Excess", order: 300, label: "Excess Cash Flow", key: "CF_EXCESS_CASH_FLOW", formulaId: "EXCESS_CASH_FLOW", precision: 0, sourcePages: [3] },
];

// ── Ratios ────────────────────────────────────────────────────────────────────

const RATIO_ROWS: StandardRow[] = [
  // Liquidity
  { statement: "RATIOS", section: "Liquidity", order: 100, label: "Working Capital", key: "R_WORKING_CAPITAL", formulaId: "WORKING_CAPITAL", precision: 0, sourcePages: [4] },
  { statement: "RATIOS", section: "Liquidity", order: 110, label: "Current Ratio", key: "R_CURRENT_RATIO", formulaId: "CURRENT_RATIO", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Liquidity", order: 120, label: "Quick Ratio", key: "R_QUICK_RATIO", formulaId: "QUICK_RATIO", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Liquidity", order: 130, label: "Net Sales / Working Capital", key: "R_SALES_WORKING_CAPITAL", formulaId: "SALES_WORKING_CAPITAL", precision: 2, sourcePages: [4] },

  // Leverage
  { statement: "RATIOS", section: "Leverage", order: 200, label: "Debt / Worth", key: "R_DEBT_TO_EQUITY", formulaId: "DEBT_TO_EQUITY", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Leverage", order: 210, label: "Total Liabilities / Total Assets", key: "R_LIABILITIES_ASSETS", formulaId: "LIABILITIES_ASSETS", precision: 4, isPercent: true, sourcePages: [4] },

  // Coverage
  { statement: "RATIOS", section: "Coverage", order: 300, label: "EBITDA ($)", key: "R_EBITDA_DOLLARS", formulaId: "EBITDA", precision: 0, sourcePages: [4] },
  { statement: "RATIOS", section: "Coverage", order: 310, label: "Interest Coverage", key: "R_INTEREST_COVERAGE", formulaId: "INTEREST_COVERAGE", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Coverage", order: 320, label: "Fixed Charge Coverage", key: "R_FIXED_CHARGE_COVERAGE", formulaId: "FIXED_CHARGE_COVERAGE", precision: 2, sourcePages: [4] },
  { statement: "RATIOS", section: "Coverage", order: 330, label: "DSCR", key: "R_DSCR", formulaId: "DSCR", precision: 2, sourcePages: [4] },

  // Profitability
  { statement: "RATIOS", section: "Profitability", order: 400, label: "Gross Margin %", key: "R_GROSS_MARGIN", formulaId: "GROSS_MARGIN", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 410, label: "Operating Expense %", key: "R_OPEX_PCT", formulaId: "OPEX_PCT", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 420, label: "Operating Profit Margin %", key: "R_OPERATING_PROFIT_MARGIN", formulaId: "OPERATING_PROFIT_MARGIN", precision: 4, isPercent: true, sourcePages: [4] },
  { statement: "RATIOS", section: "Profitability", order: 430, label: "Net Margin %", key: "R_NET_MARGIN", formulaId: "NET_MARGIN", precision: 4, isPercent: true, sourcePages: [4] },

  // Activity
  { statement: "RATIOS", section: "Activity", order: 500, label: "Net AR Days", key: "R_AR_DAYS", formulaId: "AR_DAYS", precision: 0, sourcePages: [4] },
  { statement: "RATIOS", section: "Activity", order: 510, label: "Net Sales / Total Assets", key: "R_SALES_TOTAL_ASSETS", formulaId: "SALES_TOTAL_ASSETS", precision: 2, sourcePages: [4] },
];

// ── Executive Summary (Key Metrics) ──────────────────────────────────────────

const EXEC_ROWS: StandardRow[] = [
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 100, label: "Total Revenue", key: "ES_TOTAL_REVENUE", formulaId: "TOTAL_REVENUE", precision: 0, sourcePages: [] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 110, label: "Total Assets", key: "ES_TOTAL_ASSETS", formulaId: "TOTAL_ASSETS", precision: 0, sourcePages: [] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 120, label: "Total Liabilities", key: "ES_TOTAL_LIABILITIES", formulaId: "TOTAL_LIABILITIES", precision: 0, sourcePages: [] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 130, label: "Net Worth", key: "ES_NET_WORTH", formulaId: "NET_WORTH", precision: 0, sourcePages: [] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 140, label: "EBITDA", key: "ES_EBITDA", formulaId: "EBITDA", precision: 0, sourcePages: [] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 150, label: "DSCR", key: "ES_DSCR", formulaId: "DSCR", precision: 2, sourcePages: [] },
  { statement: "EXEC_SUMMARY", section: "Key Metrics", order: 160, label: "Current Ratio", key: "ES_CURRENT_RATIO", formulaId: "CURRENT_RATIO", precision: 2, sourcePages: [] },
];

// ── Assembled Registry ────────────────────────────────────────────────────────

export const STANDARD_ROWS: StandardRow[] = [
  ...BS_CURRENT_ASSETS,
  ...BS_NONCURRENT_ASSETS,
  ...BS_CURRENT_LIABILITIES,
  ...BS_NET_WORTH,
  ...IS_ROWS,
  ...CF_ROWS,
  ...RATIO_ROWS,
  ...EXEC_ROWS,
];
