/**
 * Metric Registry — Centralized Authoritative Math Layer
 *
 * IMPORTANT:
 * - Every computed metric in the system MUST reference an entry here.
 * - No inline math in templates — all formulas route through evaluateMetric().
 * - No duplicate formulas outside this registry.
 * - Version bump required for any formula change.
 */

export type BusinessModel = "OPERATING_COMPANY" | "REAL_ESTATE" | "MIXED";

export type MetricDefinition = {
  id: string;
  label: string;
  /** Simple expression using fact keys and operators (+, -, *, /).
   *  Examples: "NOI / ANNUAL_DEBT_SERVICE", "TOTAL_INCOME - TOTAL_OPEX" */
  expr: string;
  /** Decimal places for display rounding. */
  precision: number;
  /** If true, value is a ratio expressed as 0-1 (display as %). */
  isPercent?: boolean;
  /** Fact keys that must be non-null for this metric to compute. */
  requiredFacts: string[];
  /** Which business models this metric applies to. */
  applicableTo: BusinessModel[];
  /** Bump when formula changes. */
  version: number;
};

const ALL: BusinessModel[] = ["OPERATING_COMPANY", "REAL_ESTATE", "MIXED"];
const RE: BusinessModel[] = ["REAL_ESTATE", "MIXED"];
const OP: BusinessModel[] = ["OPERATING_COMPANY", "MIXED"];

// ── Income Statement ──────────────────────────────────────────────────────────

const TOTAL_INCOME: MetricDefinition = {
  id: "TOTAL_INCOME",
  label: "Total Income",
  expr: "GROSS_RENTAL_INCOME + OTHER_INCOME - VACANCY_CONCESSIONS",
  precision: 0,
  requiredFacts: ["GROSS_RENTAL_INCOME"],
  applicableTo: RE,
  version: 1,
};

const TOTAL_OPEX: MetricDefinition = {
  id: "TOTAL_OPEX",
  label: "Total Operating Expenses",
  expr: "REPAIRS_MAINTENANCE + UTILITIES + PROPERTY_MANAGEMENT + REAL_ESTATE_TAXES + INSURANCE + PAYROLL + MARKETING + PROFESSIONAL_FEES + OTHER_OPEX",
  precision: 0,
  requiredFacts: [],
  applicableTo: RE,
  version: 1,
};

const NOI: MetricDefinition = {
  id: "NOI",
  label: "Net Operating Income",
  expr: "TOTAL_INCOME - TOTAL_OPEX",
  precision: 0,
  requiredFacts: ["TOTAL_INCOME", "TOTAL_OPEX"],
  applicableTo: RE,
  version: 1,
};

const NOI_MARGIN: MetricDefinition = {
  id: "NOI_MARGIN",
  label: "NOI Margin",
  expr: "NOI / TOTAL_INCOME",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NOI", "TOTAL_INCOME"],
  applicableTo: RE,
  version: 1,
};

const OPEX_RATIO: MetricDefinition = {
  id: "OPEX_RATIO",
  label: "Operating Expense Ratio",
  expr: "TOTAL_OPEX / TOTAL_INCOME",
  precision: 4,
  isPercent: true,
  requiredFacts: ["TOTAL_OPEX", "TOTAL_INCOME"],
  applicableTo: RE,
  version: 1,
};

const REVENUE: MetricDefinition = {
  id: "REVENUE",
  label: "Revenue",
  expr: "REVENUE",
  precision: 0,
  requiredFacts: ["REVENUE"],
  applicableTo: ALL,
  version: 1,
};

const COGS: MetricDefinition = {
  id: "COGS",
  label: "Cost of Goods Sold",
  expr: "COGS",
  precision: 0,
  requiredFacts: ["COGS"],
  applicableTo: OP,
  version: 1,
};

const GROSS_PROFIT: MetricDefinition = {
  id: "GROSS_PROFIT",
  label: "Gross Profit",
  expr: "TOTAL_REVENUE - COST_OF_GOODS_SOLD",
  precision: 0,
  requiredFacts: ["TOTAL_REVENUE", "COST_OF_GOODS_SOLD"],
  applicableTo: ALL,
  version: 2,
};

const GROSS_MARGIN: MetricDefinition = {
  id: "GROSS_MARGIN",
  label: "Gross Margin",
  expr: "GROSS_PROFIT / TOTAL_REVENUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["GROSS_PROFIT", "TOTAL_REVENUE"],
  applicableTo: ALL,
  version: 2,
};

const EBITDA: MetricDefinition = {
  id: "EBITDA",
  label: "EBITDA",
  expr: "EBITDA",
  precision: 0,
  requiredFacts: ["EBITDA"],
  applicableTo: ALL,
  version: 1,
};

const EBITDA_MARGIN: MetricDefinition = {
  id: "EBITDA_MARGIN",
  label: "EBITDA Margin",
  expr: "EBITDA / TOTAL_REVENUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["EBITDA", "TOTAL_REVENUE"],
  applicableTo: ALL,
  version: 2,
};

const NET_INCOME: MetricDefinition = {
  id: "NET_INCOME",
  label: "Net Income",
  expr: "NET_INCOME",
  precision: 0,
  requiredFacts: ["NET_INCOME"],
  applicableTo: ALL,
  version: 1,
};

const NET_MARGIN: MetricDefinition = {
  id: "NET_MARGIN",
  label: "Net Margin",
  expr: "NET_INCOME / TOTAL_REVENUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NET_INCOME", "TOTAL_REVENUE"],
  applicableTo: ALL,
  version: 2,
};

// ── Balance Sheet ─────────────────────────────────────────────────────────────

const TOTAL_ASSETS: MetricDefinition = {
  id: "TOTAL_ASSETS",
  label: "Total Assets",
  expr: "TOTAL_ASSETS",
  precision: 0,
  requiredFacts: ["TOTAL_ASSETS"],
  applicableTo: ALL,
  version: 1,
};

const TOTAL_LIABILITIES: MetricDefinition = {
  id: "TOTAL_LIABILITIES",
  label: "Total Liabilities",
  expr: "TOTAL_LIABILITIES",
  precision: 0,
  requiredFacts: ["TOTAL_LIABILITIES"],
  applicableTo: ALL,
  version: 1,
};

const NET_WORTH: MetricDefinition = {
  id: "NET_WORTH",
  label: "Net Worth / Total Equity",
  expr: "TOTAL_ASSETS - TOTAL_LIABILITIES",
  precision: 0,
  requiredFacts: ["TOTAL_ASSETS", "TOTAL_LIABILITIES"],
  applicableTo: ALL,
  version: 1,
};

const WORKING_CAPITAL: MetricDefinition = {
  id: "WORKING_CAPITAL",
  label: "Working Capital",
  expr: "TOTAL_CURRENT_ASSETS - TOTAL_CURRENT_LIABILITIES",
  precision: 0,
  requiredFacts: ["TOTAL_CURRENT_ASSETS", "TOTAL_CURRENT_LIABILITIES"],
  applicableTo: ALL,
  version: 1,
};

const CURRENT_RATIO: MetricDefinition = {
  id: "CURRENT_RATIO",
  label: "Current Ratio",
  expr: "TOTAL_CURRENT_ASSETS / TOTAL_CURRENT_LIABILITIES",
  precision: 2,
  requiredFacts: ["TOTAL_CURRENT_ASSETS", "TOTAL_CURRENT_LIABILITIES"],
  applicableTo: ALL,
  version: 1,
};

const DEBT_TO_EQUITY: MetricDefinition = {
  id: "DEBT_TO_EQUITY",
  label: "Debt-to-Equity",
  expr: "TOTAL_LIABILITIES / NET_WORTH",
  precision: 2,
  requiredFacts: ["TOTAL_LIABILITIES", "NET_WORTH"],
  applicableTo: ALL,
  version: 1,
};

const EQUITY_RATIO: MetricDefinition = {
  id: "EQUITY_RATIO",
  label: "Equity Ratio",
  expr: "NET_WORTH / TOTAL_ASSETS",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NET_WORTH", "TOTAL_ASSETS"],
  applicableTo: ALL,
  version: 1,
};

// ── Cash Flow / Coverage ──────────────────────────────────────────────────────

const CASH_FLOW_AVAILABLE: MetricDefinition = {
  id: "CASH_FLOW_AVAILABLE",
  label: "Cash Flow Available for Debt Service",
  expr: "CASH_FLOW_AVAILABLE",
  precision: 0,
  requiredFacts: ["CASH_FLOW_AVAILABLE"],
  applicableTo: ALL,
  version: 1,
};

const ANNUAL_DEBT_SERVICE: MetricDefinition = {
  id: "ANNUAL_DEBT_SERVICE",
  label: "Annual Debt Service",
  expr: "ANNUAL_DEBT_SERVICE",
  precision: 0,
  requiredFacts: ["ANNUAL_DEBT_SERVICE"],
  applicableTo: ALL,
  version: 1,
};

const EXCESS_CASH_FLOW: MetricDefinition = {
  id: "EXCESS_CASH_FLOW",
  label: "Excess Cash Flow",
  expr: "CASH_FLOW_AVAILABLE - ANNUAL_DEBT_SERVICE",
  precision: 0,
  requiredFacts: ["CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE"],
  applicableTo: ALL,
  version: 1,
};

const DSCR: MetricDefinition = {
  id: "DSCR",
  label: "Debt Service Coverage Ratio",
  expr: "CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE",
  precision: 2,
  requiredFacts: ["CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE"],
  applicableTo: ALL,
  version: 1,
};

const DSCR_STRESSED_300BPS: MetricDefinition = {
  id: "DSCR_STRESSED_300BPS",
  label: "DSCR (Stressed +300bps)",
  expr: "CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
  precision: 2,
  requiredFacts: ["CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE_STRESSED_300BPS"],
  applicableTo: ALL,
  version: 1,
};

const DEBT_YIELD: MetricDefinition = {
  id: "DEBT_YIELD",
  label: "Debt Yield",
  expr: "NOI / BANK_LOAN_TOTAL",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NOI", "BANK_LOAN_TOTAL"],
  applicableTo: RE,
  version: 1,
};

const CAP_RATE: MetricDefinition = {
  id: "CAP_RATE",
  label: "Cap Rate",
  expr: "NOI / COLLATERAL_GROSS_VALUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NOI", "COLLATERAL_GROSS_VALUE"],
  applicableTo: RE,
  version: 1,
};

// ── Collateral / LTV ─────────────────────────────────────────────────────────

const LTV_GROSS: MetricDefinition = {
  id: "LTV_GROSS",
  label: "LTV (Gross)",
  expr: "BANK_LOAN_TOTAL / COLLATERAL_GROSS_VALUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["BANK_LOAN_TOTAL", "COLLATERAL_GROSS_VALUE"],
  applicableTo: ALL,
  version: 1,
};

const LTV_NET: MetricDefinition = {
  id: "LTV_NET",
  label: "LTV (Net)",
  expr: "BANK_LOAN_TOTAL / COLLATERAL_NET_VALUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["BANK_LOAN_TOTAL", "COLLATERAL_NET_VALUE"],
  applicableTo: ALL,
  version: 1,
};

const COLLATERAL_COVERAGE: MetricDefinition = {
  id: "COLLATERAL_COVERAGE",
  label: "Collateral Coverage",
  expr: "COLLATERAL_DISCOUNTED_VALUE / BANK_LOAN_TOTAL",
  precision: 2,
  requiredFacts: ["COLLATERAL_DISCOUNTED_VALUE", "BANK_LOAN_TOTAL"],
  applicableTo: ALL,
  version: 1,
};

// ── Global Cash Flow ──────────────────────────────────────────────────────────

const GCF_GLOBAL_CASH_FLOW: MetricDefinition = {
  id: "GCF_GLOBAL_CASH_FLOW",
  label: "Global Cash Flow",
  expr: "GCF_GLOBAL_CASH_FLOW",
  precision: 0,
  requiredFacts: ["GCF_GLOBAL_CASH_FLOW"],
  applicableTo: ALL,
  version: 1,
};

const GCF_DSCR: MetricDefinition = {
  id: "GCF_DSCR",
  label: "Global DSCR",
  expr: "GCF_GLOBAL_CASH_FLOW / ANNUAL_DEBT_SERVICE",
  precision: 2,
  requiredFacts: ["GCF_GLOBAL_CASH_FLOW", "ANNUAL_DEBT_SERVICE"],
  applicableTo: ALL,
  version: 1,
};

// ── MMAS Standard Metrics ────────────────────────────────────────────────────

const NET_OPERATING_PROFIT: MetricDefinition = {
  id: "NET_OPERATING_PROFIT",
  label: "Net Operating Profit",
  expr: "GROSS_PROFIT - TOTAL_OPERATING_EXPENSES",
  precision: 0,
  requiredFacts: ["GROSS_PROFIT", "TOTAL_OPERATING_EXPENSES"],
  applicableTo: ALL,
  version: 1,
};

const EBIT: MetricDefinition = {
  id: "EBIT",
  label: "EBIT",
  expr: "EBITDA - DEPRECIATION",
  precision: 0,
  requiredFacts: ["EBITDA", "DEPRECIATION"],
  applicableTo: ALL,
  version: 1,
};

const QUICK_ASSETS: MetricDefinition = {
  id: "QUICK_ASSETS",
  label: "Quick Assets",
  expr: "CASH_AND_EQUIVALENTS + ACCOUNTS_RECEIVABLE",
  precision: 0,
  requiredFacts: ["CASH_AND_EQUIVALENTS", "ACCOUNTS_RECEIVABLE"],
  applicableTo: ALL,
  version: 1,
};

const QUICK_RATIO: MetricDefinition = {
  id: "QUICK_RATIO",
  label: "Quick Ratio",
  expr: "QUICK_ASSETS / TOTAL_CURRENT_LIABILITIES",
  precision: 2,
  requiredFacts: ["QUICK_ASSETS", "TOTAL_CURRENT_LIABILITIES"],
  applicableTo: ALL,
  version: 1,
};

const SALES_WORKING_CAPITAL: MetricDefinition = {
  id: "SALES_WORKING_CAPITAL",
  label: "Net Sales / Working Capital",
  expr: "TOTAL_REVENUE / WORKING_CAPITAL",
  precision: 2,
  requiredFacts: ["TOTAL_REVENUE", "WORKING_CAPITAL"],
  applicableTo: OP,
  version: 1,
};

const LIABILITIES_ASSETS: MetricDefinition = {
  id: "LIABILITIES_ASSETS",
  label: "Total Liabilities / Total Assets",
  expr: "TOTAL_LIABILITIES / TOTAL_ASSETS",
  precision: 4,
  isPercent: true,
  requiredFacts: ["TOTAL_LIABILITIES", "TOTAL_ASSETS"],
  applicableTo: ALL,
  version: 1,
};

const INTEREST_COVERAGE: MetricDefinition = {
  id: "INTEREST_COVERAGE",
  label: "Interest Coverage",
  expr: "EBIT / INTEREST_EXPENSE",
  precision: 2,
  requiredFacts: ["EBIT", "INTEREST_EXPENSE"],
  applicableTo: ALL,
  version: 1,
};

const OPERATING_PROFIT_MARGIN: MetricDefinition = {
  id: "OPERATING_PROFIT_MARGIN",
  label: "Operating Profit Margin",
  expr: "NET_OPERATING_PROFIT / TOTAL_REVENUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NET_OPERATING_PROFIT", "TOTAL_REVENUE"],
  applicableTo: ALL,
  version: 1,
};

const ROA: MetricDefinition = {
  id: "ROA",
  label: "Return on Assets",
  expr: "NET_INCOME / TOTAL_ASSETS",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NET_INCOME", "TOTAL_ASSETS"],
  applicableTo: ALL,
  version: 1,
};

const ROE: MetricDefinition = {
  id: "ROE",
  label: "Return on Equity",
  expr: "NET_INCOME / NET_WORTH",
  precision: 4,
  isPercent: true,
  requiredFacts: ["NET_INCOME", "NET_WORTH"],
  applicableTo: ALL,
  version: 1,
};

const AR_DAYS: MetricDefinition = {
  id: "AR_DAYS",
  label: "Net AR Days",
  expr: "ACCOUNTS_RECEIVABLE / TOTAL_REVENUE * 365",
  precision: 0,
  requiredFacts: ["ACCOUNTS_RECEIVABLE", "TOTAL_REVENUE"],
  applicableTo: OP,
  version: 1,
};

const SALES_TOTAL_ASSETS: MetricDefinition = {
  id: "SALES_TOTAL_ASSETS",
  label: "Net Sales / Total Assets",
  expr: "TOTAL_REVENUE / TOTAL_ASSETS",
  precision: 2,
  requiredFacts: ["TOTAL_REVENUE", "TOTAL_ASSETS"],
  applicableTo: ALL,
  version: 1,
};

const OPEX_PCT: MetricDefinition = {
  id: "OPEX_PCT",
  label: "Operating Expense %",
  expr: "TOTAL_OPERATING_EXPENSES / TOTAL_REVENUE",
  precision: 4,
  isPercent: true,
  requiredFacts: ["TOTAL_OPERATING_EXPENSES", "TOTAL_REVENUE"],
  applicableTo: ALL,
  version: 1,
};

const FIXED_CHARGES: MetricDefinition = {
  id: "FIXED_CHARGES",
  label: "Fixed Charges",
  expr: "INTEREST_EXPENSE + RENT_EXPENSE",
  precision: 0,
  requiredFacts: ["INTEREST_EXPENSE"],
  applicableTo: ALL,
  version: 1,
};

const FIXED_CHARGE_COVERAGE: MetricDefinition = {
  id: "FIXED_CHARGE_COVERAGE",
  label: "Fixed Charge Coverage",
  expr: "EBITDA / FIXED_CHARGES",
  precision: 2,
  requiredFacts: ["EBITDA", "FIXED_CHARGES"],
  applicableTo: ALL,
  version: 1,
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  // Income Statement
  TOTAL_INCOME,
  TOTAL_OPEX,
  NOI,
  NOI_MARGIN,
  OPEX_RATIO,
  REVENUE,
  COGS,
  GROSS_PROFIT,
  GROSS_MARGIN,
  EBITDA,
  EBITDA_MARGIN,
  NET_INCOME,
  NET_MARGIN,
  // Balance Sheet
  TOTAL_ASSETS,
  TOTAL_LIABILITIES,
  NET_WORTH,
  WORKING_CAPITAL,
  CURRENT_RATIO,
  DEBT_TO_EQUITY,
  EQUITY_RATIO,
  // Cash Flow / Coverage
  CASH_FLOW_AVAILABLE,
  ANNUAL_DEBT_SERVICE,
  EXCESS_CASH_FLOW,
  DSCR,
  DSCR_STRESSED_300BPS,
  DEBT_YIELD,
  CAP_RATE,
  // Collateral / LTV
  LTV_GROSS,
  LTV_NET,
  COLLATERAL_COVERAGE,
  // Global Cash Flow
  GCF_GLOBAL_CASH_FLOW,
  GCF_DSCR,
  // MMAS Standard Metrics
  NET_OPERATING_PROFIT,
  EBIT,
  QUICK_ASSETS,
  QUICK_RATIO,
  SALES_WORKING_CAPITAL,
  LIABILITIES_ASSETS,
  INTEREST_COVERAGE,
  OPERATING_PROFIT_MARGIN,
  ROA,
  ROE,
  AR_DAYS,
  SALES_TOTAL_ASSETS,
  OPEX_PCT,
  FIXED_CHARGES,
  FIXED_CHARGE_COVERAGE,
};

/** Current version of the metric registry — bump on any formula change. */
export const METRIC_REGISTRY_VERSION = 2;
