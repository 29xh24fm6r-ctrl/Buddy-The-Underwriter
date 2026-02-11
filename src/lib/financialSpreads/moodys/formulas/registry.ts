/**
 * Moody's Financial Analysis — Formula Registry (Locked)
 *
 * IMPORTANT:
 * - All computed lines MUST use a formulaId from this registry.
 * - Do not change formulas without updating the golden fixture tests.
 * - Every formula delegates to the centralized Metric Registry via metricRegistryId.
 * - No inline math — evaluateMetric() is the single evaluation path.
 */

export type MoodysFormula = {
  id: string;
  /** Human-readable expression for display/audit. */
  expr: string;
  /** Links to METRIC_REGISTRY entry. evaluateMetric(metricRegistryId, facts) is the evaluation path.
   *  If null, this is a structural aggregation formula handled by the renderer. */
  metricRegistryId: string | null;
  precision?: number;
  sourcePages: number[];
};

export const MOODYS_FORMULAS: Record<string, MoodysFormula> = {
  // ── Balance Sheet Subtotals ─────────────────────────────────────────────────

  TOTAL_CURRENT_ASSETS: {
    id: "TOTAL_CURRENT_ASSETS",
    expr: "CASH_AND_EQUIVALENTS + ACCOUNTS_RECEIVABLE + INVENTORY + PREPAID_EXPENSES + OTHER_CURRENT_ASSETS",
    metricRegistryId: null, // structural sum — evaluated by renderer
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_ASSETS: {
    id: "TOTAL_ASSETS",
    expr: "TOTAL_CURRENT_ASSETS + FIXED_ASSETS_NET + REAL_ESTATE_HELD + INTANGIBLE_ASSETS + OTHER_NONCURRENT_ASSETS",
    metricRegistryId: "TOTAL_ASSETS",
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_CURRENT_LIABILITIES: {
    id: "TOTAL_CURRENT_LIABILITIES",
    expr: "ACCOUNTS_PAYABLE + ACCRUED_EXPENSES + CURRENT_MATURITIES_LTD + OTHER_CURRENT_LIABILITIES",
    metricRegistryId: null, // structural sum — evaluated by renderer
    precision: 0,
    sourcePages: [1],
  },

  TOTAL_LIABILITIES: {
    id: "TOTAL_LIABILITIES",
    expr: "TOTAL_CURRENT_LIABILITIES + LONG_TERM_DEBT + OTHER_LT_LIABILITIES",
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
    metricRegistryId: null, // balance check — evaluated by renderer
    precision: 0,
    sourcePages: [1],
  },

  // ── Income Statement Computed Lines ─────────────────────────────────────────

  TOTAL_INCOME: {
    id: "TOTAL_INCOME",
    expr: "GROSS_RENTAL_INCOME + OTHER_INCOME - VACANCY_CONCESSIONS",
    metricRegistryId: "TOTAL_INCOME",
    precision: 0,
    sourcePages: [2],
  },

  GROSS_PROFIT: {
    id: "GROSS_PROFIT",
    expr: "REVENUE - COGS",
    metricRegistryId: "GROSS_PROFIT",
    precision: 0,
    sourcePages: [2],
  },

  TOTAL_OPEX: {
    id: "TOTAL_OPEX",
    expr: "REPAIRS_MAINTENANCE + UTILITIES + PROPERTY_MANAGEMENT + REAL_ESTATE_TAXES + INSURANCE + PAYROLL + MARKETING + PROFESSIONAL_FEES + OTHER_OPEX",
    metricRegistryId: "TOTAL_OPEX",
    precision: 0,
    sourcePages: [2],
  },

  NOI: {
    id: "NOI",
    expr: "TOTAL_INCOME - TOTAL_OPEX",
    metricRegistryId: "NOI",
    precision: 0,
    sourcePages: [2],
  },

  EBITDA_PROXY: {
    id: "EBITDA_PROXY",
    expr: "EBITDA",
    metricRegistryId: "EBITDA",
    precision: 0,
    sourcePages: [2],
  },

  PRE_TAX_INCOME: {
    id: "PRE_TAX_INCOME",
    expr: "NOI - DEPRECIATION_AMORTIZATION - INTEREST_EXPENSE + OTHER_NON_OPERATING",
    metricRegistryId: null, // structural — evaluated by renderer
    precision: 0,
    sourcePages: [2],
  },

  NET_INCOME: {
    id: "NET_INCOME",
    expr: "PRE_TAX_INCOME - TAX_PROVISION",
    metricRegistryId: "NET_INCOME",
    precision: 0,
    sourcePages: [2],
  },

  NET_CASH_FLOW_BEFORE_DEBT: {
    id: "NET_CASH_FLOW_BEFORE_DEBT",
    expr: "NOI - REPLACEMENT_RESERVES - CAPEX",
    metricRegistryId: null, // structural — evaluated by renderer
    precision: 0,
    sourcePages: [2],
  },

  EXCESS_CASH_FLOW: {
    id: "EXCESS_CASH_FLOW",
    expr: "CASH_FLOW_AVAILABLE - ANNUAL_DEBT_SERVICE",
    metricRegistryId: "EXCESS_CASH_FLOW",
    precision: 0,
    sourcePages: [2, 3],
  },

  // ── Cash Flow Computed Lines ────────────────────────────────────────────────

  CASH_FLOW_AVAILABLE_CALC: {
    id: "CASH_FLOW_AVAILABLE_CALC",
    expr: "CASH_FLOW_AVAILABLE",
    metricRegistryId: "CASH_FLOW_AVAILABLE",
    precision: 0,
    sourcePages: [3],
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

  DEBT_TO_EQUITY: {
    id: "DEBT_TO_EQUITY",
    expr: "TOTAL_LIABILITIES / NET_WORTH",
    metricRegistryId: "DEBT_TO_EQUITY",
    precision: 2,
    sourcePages: [4],
  },

  EQUITY_RATIO: {
    id: "EQUITY_RATIO",
    expr: "NET_WORTH / TOTAL_ASSETS",
    metricRegistryId: "EQUITY_RATIO",
    precision: 4,
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

  DEBT_YIELD: {
    id: "DEBT_YIELD",
    expr: "NOI / BANK_LOAN_TOTAL",
    metricRegistryId: "DEBT_YIELD",
    precision: 4,
    sourcePages: [4],
  },

  GROSS_MARGIN: {
    id: "GROSS_MARGIN",
    expr: "GROSS_PROFIT / REVENUE",
    metricRegistryId: "GROSS_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  EBITDA_MARGIN: {
    id: "EBITDA_MARGIN",
    expr: "EBITDA / REVENUE",
    metricRegistryId: "EBITDA_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  NET_MARGIN: {
    id: "NET_MARGIN",
    expr: "NET_INCOME / REVENUE",
    metricRegistryId: "NET_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  NOI_MARGIN: {
    id: "NOI_MARGIN",
    expr: "NOI / TOTAL_INCOME",
    metricRegistryId: "NOI_MARGIN",
    precision: 4,
    sourcePages: [4],
  },

  OPEX_RATIO: {
    id: "OPEX_RATIO",
    expr: "TOTAL_OPEX / TOTAL_INCOME",
    metricRegistryId: "OPEX_RATIO",
    precision: 4,
    sourcePages: [4],
  },

  CAP_RATE: {
    id: "CAP_RATE",
    expr: "NOI / COLLATERAL_GROSS_VALUE",
    metricRegistryId: "CAP_RATE",
    precision: 4,
    sourcePages: [4],
  },

  LTV_GROSS: {
    id: "LTV_GROSS",
    expr: "BANK_LOAN_TOTAL / COLLATERAL_GROSS_VALUE",
    metricRegistryId: "LTV_GROSS",
    precision: 4,
    sourcePages: [4],
  },

  LTV_NET: {
    id: "LTV_NET",
    expr: "BANK_LOAN_TOTAL / COLLATERAL_NET_VALUE",
    metricRegistryId: "LTV_NET",
    precision: 4,
    sourcePages: [4],
  },

  COLLATERAL_COVERAGE: {
    id: "COLLATERAL_COVERAGE",
    expr: "COLLATERAL_DISCOUNTED_VALUE / BANK_LOAN_TOTAL",
    metricRegistryId: "COLLATERAL_COVERAGE",
    precision: 2,
    sourcePages: [4],
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

  // ── Exec Summary (reuse same registry IDs) ─────────────────────────────────
  // No separate entries needed — EXEC_SUMMARY rows reference the same formulaIds above.

  REVENUE: {
    id: "REVENUE",
    expr: "REVENUE",
    metricRegistryId: "REVENUE",
    precision: 0,
    sourcePages: [0],
  },
};
