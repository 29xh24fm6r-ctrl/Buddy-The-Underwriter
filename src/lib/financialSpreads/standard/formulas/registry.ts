/**
 * Financial Analysis (Standard Spread) — Formula Registry (MMAS)
 *
 * IMPORTANT:
 * - All computed lines MUST use a formulaId from this registry.
 * - Do not change formulas without updating the golden fixture tests.
 * - Every formula delegates to the centralized Metric Registry via metricRegistryId.
 * - No inline math — evaluateMetric() is the single evaluation path.
 */

export type StandardFormula = {
  id: string;
  /** Human-readable expression for display/audit. */
  expr: string;
  /** Links to METRIC_REGISTRY entry. evaluateMetric(metricRegistryId, facts) is the evaluation path.
   *  If null, this is a structural aggregation formula handled by the renderer. */
  metricRegistryId: string | null;
  precision?: number;
  sourcePages: number[];
};

export const STANDARD_FORMULAS: Record<string, StandardFormula> = {
  // ── Balance Sheet Subtotals ─────────────────────────────────────────────────

  TOTAL_CURRENT_ASSETS: {
    id: "TOTAL_CURRENT_ASSETS",
    expr: "CASH_AND_EQUIVALENTS + ACCOUNTS_RECEIVABLE + INVENTORY + OTHER_CURRENT_ASSETS",
    metricRegistryId: null, // structural sum
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_NONCURRENT_ASSETS: {
    id: "TOTAL_NONCURRENT_ASSETS",
    expr: "FIXED_ASSETS_NET + LT_RECEIVABLES + INTANGIBLES_NET",
    metricRegistryId: null, // structural sum
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_ASSETS: {
    id: "TOTAL_ASSETS",
    expr: "TOTAL_CURRENT_ASSETS + TOTAL_NONCURRENT_ASSETS",
    metricRegistryId: "TOTAL_ASSETS",
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_CURRENT_LIABILITIES: {
    id: "TOTAL_CURRENT_LIABILITIES",
    expr: "ST_LOANS_PAYABLE + ACCOUNTS_PAYABLE + ACCRUED_LIABILITIES + OTHER_CURRENT_LIABILITIES",
    metricRegistryId: null, // structural sum
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_LIABILITIES: {
    id: "TOTAL_LIABILITIES",
    expr: "TOTAL_CURRENT_LIABILITIES",
    metricRegistryId: "TOTAL_LIABILITIES",
    precision: 0,
    sourcePages: [1],
  },

  NET_WORTH: {
    id: "NET_WORTH",
    expr: "TOTAL_ASSETS - TOTAL_LIABILITIES",
    metricRegistryId: "NET_WORTH",
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_LIABILITIES_AND_EQUITY: {
    id: "TOTAL_LIABILITIES_AND_EQUITY",
    expr: "TOTAL_LIABILITIES + NET_WORTH",
    metricRegistryId: null, // balance check
    precision: 0,
    sourcePages: [1],
  },

  // ── Income Statement Computed Lines ─────────────────────────────────────────

  GROSS_PROFIT: {
    id: "GROSS_PROFIT",
    expr: "TOTAL_REVENUE - COST_OF_GOODS_SOLD",
    metricRegistryId: "GROSS_PROFIT",
    precision: 0,
    sourcePages: [2],
  },

  TOTAL_OPERATING_EXPENSES: {
    id: "TOTAL_OPERATING_EXPENSES",
    expr: "OFFICER_COMPENSATION + PAYROLL + OPERATING_EXPENSE + REPAIRS_MAINTENANCE + RENT_EXPENSE + DEPRECIATION + INTEREST_EXPENSE + OTHER_DEDUCTIONS",
    metricRegistryId: null, // structural sum — includes Interest per MMAS
    precision: 0,
    sourcePages: [2],
  },

  NET_OPERATING_PROFIT: {
    id: "NET_OPERATING_PROFIT",
    expr: "GROSS_PROFIT - TOTAL_OPERATING_EXPENSES",
    metricRegistryId: "NET_OPERATING_PROFIT",
    precision: 0,
    sourcePages: [2],
  },

  NET_PROFIT: {
    id: "NET_PROFIT",
    expr: "NET_OPERATING_PROFIT + OTHER_INCOME - OTHER_EXPENSE",
    metricRegistryId: null, // structural
    precision: 0,
    sourcePages: [2],
  },

  EBITDA_CALC: {
    id: "EBITDA_CALC",
    expr: "EBITDA",
    metricRegistryId: "EBITDA",
    precision: 0,
    sourcePages: [2],
  },

  // ── Cash Flow Computed Lines ────────────────────────────────────────────────

  CASH_FLOW_AVAILABLE_CALC: {
    id: "CASH_FLOW_AVAILABLE_CALC",
    expr: "CASH_FLOW_AVAILABLE",
    metricRegistryId: "CASH_FLOW_AVAILABLE",
    precision: 0,
    sourcePages: [3],
  },

  EXCESS_CASH_FLOW: {
    id: "EXCESS_CASH_FLOW",
    expr: "CASH_FLOW_AVAILABLE - ANNUAL_DEBT_SERVICE",
    metricRegistryId: "EXCESS_CASH_FLOW",
    precision: 0,
    sourcePages: [3],
  },

  // ── Exec Summary pass-through formulas ──────────────────────────────────────

  TOTAL_REVENUE: {
    id: "TOTAL_REVENUE",
    expr: "TOTAL_REVENUE",
    metricRegistryId: null, // direct fact
    precision: 0,
    sourcePages: [0],
  },

  // ── Ratios (all delegate to Metric Registry) ───────────────────────────────

  CURRENT_RATIO: {
    id: "CURRENT_RATIO",
    expr: "TOTAL_CURRENT_ASSETS / TOTAL_CURRENT_LIABILITIES",
    metricRegistryId: "CURRENT_RATIO",
    precision: 2,
    sourcePages: [4],
  },

  WORKING_CAPITAL: {
    id: "WORKING_CAPITAL",
    expr: "TOTAL_CURRENT_ASSETS - TOTAL_CURRENT_LIABILITIES",
    metricRegistryId: "WORKING_CAPITAL",
    precision: 0,
    sourcePages: [4],
  },

  QUICK_RATIO: {
    id: "QUICK_RATIO",
    expr: "QUICK_ASSETS / TOTAL_CURRENT_LIABILITIES",
    metricRegistryId: "QUICK_RATIO",
    precision: 2,
    sourcePages: [4],
  },

  SALES_WORKING_CAPITAL: {
    id: "SALES_WORKING_CAPITAL",
    expr: "TOTAL_REVENUE / WORKING_CAPITAL",
    metricRegistryId: "SALES_WORKING_CAPITAL",
    precision: 2,
    sourcePages: [4],
  },

  DEBT_TO_EQUITY: {
    id: "DEBT_TO_EQUITY",
    expr: "TOTAL_LIABILITIES / NET_WORTH",
    metricRegistryId: "DEBT_TO_EQUITY",
    precision: 2,
    sourcePages: [4],
  },

  LIABILITIES_ASSETS: {
    id: "LIABILITIES_ASSETS",
    expr: "TOTAL_LIABILITIES / TOTAL_ASSETS",
    metricRegistryId: "LIABILITIES_ASSETS",
    precision: 4,
    sourcePages: [4],
  },

  INTEREST_COVERAGE: {
    id: "INTEREST_COVERAGE",
    expr: "EBIT / INTEREST_EXPENSE",
    metricRegistryId: "INTEREST_COVERAGE",
    precision: 2,
    sourcePages: [4],
  },

  FIXED_CHARGE_COVERAGE: {
    id: "FIXED_CHARGE_COVERAGE",
    expr: "EBITDA / FIXED_CHARGES",
    metricRegistryId: "FIXED_CHARGE_COVERAGE",
    precision: 2,
    sourcePages: [4],
  },

  DSCR: {
    id: "DSCR",
    expr: "CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE",
    metricRegistryId: "DSCR",
    precision: 2,
    sourcePages: [4],
  },

  DSCR_STRESSED_300BPS: {
    id: "DSCR_STRESSED_300BPS",
    expr: "CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
    metricRegistryId: "DSCR_STRESSED_300BPS",
    precision: 2,
    sourcePages: [4],
  },

  GROSS_MARGIN: {
    id: "GROSS_MARGIN",
    expr: "GROSS_PROFIT / TOTAL_REVENUE",
    metricRegistryId: "GROSS_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  OPEX_PCT: {
    id: "OPEX_PCT",
    expr: "TOTAL_OPERATING_EXPENSES / TOTAL_REVENUE",
    metricRegistryId: "OPEX_PCT",
    precision: 4,
    sourcePages: [4],
  },

  OPERATING_PROFIT_MARGIN: {
    id: "OPERATING_PROFIT_MARGIN",
    expr: "NET_OPERATING_PROFIT / TOTAL_REVENUE",
    metricRegistryId: "OPERATING_PROFIT_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  EBITDA_MARGIN: {
    id: "EBITDA_MARGIN",
    expr: "EBITDA / TOTAL_REVENUE",
    metricRegistryId: "EBITDA_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  NET_MARGIN: {
    id: "NET_MARGIN",
    expr: "NET_INCOME / TOTAL_REVENUE",
    metricRegistryId: "NET_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  ROA: {
    id: "ROA",
    expr: "NET_INCOME / TOTAL_ASSETS",
    metricRegistryId: "ROA",
    precision: 4,
    sourcePages: [4],
  },

  ROE: {
    id: "ROE",
    expr: "NET_INCOME / NET_WORTH",
    metricRegistryId: "ROE",
    precision: 4,
    sourcePages: [4],
  },

  AR_DAYS: {
    id: "AR_DAYS",
    expr: "ACCOUNTS_RECEIVABLE / TOTAL_REVENUE * 365",
    metricRegistryId: "AR_DAYS",
    precision: 0,
    sourcePages: [4],
  },

  SALES_TOTAL_ASSETS: {
    id: "SALES_TOTAL_ASSETS",
    expr: "TOTAL_REVENUE / TOTAL_ASSETS",
    metricRegistryId: "SALES_TOTAL_ASSETS",
    precision: 2,
    sourcePages: [4],
  },

  // ── CRE metrics (kept for T12/RentRoll/GCF templates) ──────────────────────

  EBITDA: {
    id: "EBITDA",
    expr: "EBITDA",
    metricRegistryId: "EBITDA",
    precision: 0,
    sourcePages: [2],
  },

  GCF_GLOBAL_CASH_FLOW: {
    id: "GCF_GLOBAL_CASH_FLOW",
    expr: "GCF_GLOBAL_CASH_FLOW",
    metricRegistryId: "GCF_GLOBAL_CASH_FLOW",
    precision: 0,
    sourcePages: [4],
  },

  GCF_DSCR: {
    id: "GCF_DSCR",
    expr: "GCF_GLOBAL_CASH_FLOW / ANNUAL_DEBT_SERVICE",
    metricRegistryId: "GCF_DSCR",
    precision: 2,
    sourcePages: [4],
  },
};
