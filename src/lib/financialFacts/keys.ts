import "server-only";

export type FinancialFactSourceType = "SPREAD" | "DOC_EXTRACT" | "MANUAL" | "STRUCTURAL";

export type FinancialFactProvenance = {
  source_type: FinancialFactSourceType;
  source_ref: string; // e.g. `deal_spreads:GLOBAL_CASH_FLOW:v1` or `deal_documents:<uuid>`
  as_of_date: string | null; // ISO date (YYYY-MM-DD) when known

  extractor?: string; // versioned extractor id
  calc?: string; // for derived values

  confidence?: number | null;
  citations?: Array<{
    page: number | null;
    snippet: string;
  }>;
  raw_snippets?: string[];
};

export type CanonicalFact = {
  canonical_key:
    | "CASH_FLOW_AVAILABLE"
    | "ANNUAL_DEBT_SERVICE"
    | "EXCESS_CASH_FLOW"
    | "DSCR"
    | "DSCR_STRESSED_300BPS"
    | "COLLATERAL_GROSS_VALUE"
    | "COLLATERAL_NET_VALUE"
    | "COLLATERAL_DISCOUNTED_VALUE"
    | "COLLATERAL_DISCOUNTED_COVERAGE"
    | "LTV_GROSS"
    | "LTV_NET"
    | "TOTAL_PROJECT_COST"
    | "BORROWER_EQUITY"
    | "BORROWER_EQUITY_PCT"
    | "BANK_LOAN_TOTAL"
    | "NOI_TTM"
    | "TOTAL_INCOME_TTM"
    | "OPEX_TTM"
    | "IN_PLACE_RENT_MO"
    | "OCCUPANCY_PCT"
    | "VACANCY_PCT"
    // Balance sheet metrics
    | "TOTAL_ASSETS"
    | "TOTAL_LIABILITIES"
    | "NET_WORTH"
    // Tax return / global cash flow metrics
    | "GROSS_RECEIPTS"
    | "DEPRECIATION_ADDBACK"
    | "GLOBAL_CASH_FLOW"
    // Personal income / PFS / GCF metrics
    | "PERSONAL_TOTAL_INCOME"
    | "PFS_TOTAL_ASSETS"
    | "PFS_TOTAL_LIABILITIES"
    | "PFS_NET_WORTH"
    | "GCF_GLOBAL_CASH_FLOW"
    | "GCF_DSCR"
    // Structural debt service breakdown
    | "ANNUAL_DEBT_SERVICE_PROPOSED"
    | "ANNUAL_DEBT_SERVICE_EXISTING"
    // Income statement computed metrics
    | "REVENUE"
    | "COGS"
    | "GROSS_PROFIT"
    | "EBITDA"
    | "NET_INCOME"
    // Balance sheet computed metrics
    | "WORKING_CAPITAL"
    | "CURRENT_RATIO"
    | "DEBT_TO_EQUITY";
  fact_type: "FINANCIAL_ANALYSIS" | "COLLATERAL" | "SOURCES_USES" | "BALANCE_SHEET" | "TAX_RETURN" | "PERSONAL_INCOME" | "PERSONAL_FINANCIAL_STATEMENT";
  fact_key: string;
};

export const CANONICAL_FACTS: Record<CanonicalFact["canonical_key"], CanonicalFact> = {
  CASH_FLOW_AVAILABLE: {
    canonical_key: "CASH_FLOW_AVAILABLE",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "CASH_FLOW_AVAILABLE",
  },
  ANNUAL_DEBT_SERVICE: {
    canonical_key: "ANNUAL_DEBT_SERVICE",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "ANNUAL_DEBT_SERVICE",
  },
  EXCESS_CASH_FLOW: {
    canonical_key: "EXCESS_CASH_FLOW",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "EXCESS_CASH_FLOW",
  },
  DSCR: {
    canonical_key: "DSCR",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "DSCR",
  },
  DSCR_STRESSED_300BPS: {
    canonical_key: "DSCR_STRESSED_300BPS",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "DSCR_STRESSED_300BPS",
  },

  COLLATERAL_GROSS_VALUE: {
    canonical_key: "COLLATERAL_GROSS_VALUE",
    fact_type: "COLLATERAL",
    fact_key: "GROSS_VALUE",
  },
  COLLATERAL_NET_VALUE: {
    canonical_key: "COLLATERAL_NET_VALUE",
    fact_type: "COLLATERAL",
    fact_key: "NET_VALUE",
  },
  COLLATERAL_DISCOUNTED_VALUE: {
    canonical_key: "COLLATERAL_DISCOUNTED_VALUE",
    fact_type: "COLLATERAL",
    fact_key: "DISCOUNTED_VALUE",
  },
  COLLATERAL_DISCOUNTED_COVERAGE: {
    canonical_key: "COLLATERAL_DISCOUNTED_COVERAGE",
    fact_type: "COLLATERAL",
    fact_key: "DISCOUNTED_COVERAGE",
  },

  LTV_GROSS: {
    canonical_key: "LTV_GROSS",
    fact_type: "COLLATERAL",
    fact_key: "LTV_GROSS",
  },
  LTV_NET: {
    canonical_key: "LTV_NET",
    fact_type: "COLLATERAL",
    fact_key: "LTV_NET",
  },

  TOTAL_PROJECT_COST: {
    canonical_key: "TOTAL_PROJECT_COST",
    fact_type: "SOURCES_USES",
    fact_key: "TOTAL_PROJECT_COST",
  },
  BORROWER_EQUITY: {
    canonical_key: "BORROWER_EQUITY",
    fact_type: "SOURCES_USES",
    fact_key: "BORROWER_EQUITY",
  },
  BORROWER_EQUITY_PCT: {
    canonical_key: "BORROWER_EQUITY_PCT",
    fact_type: "SOURCES_USES",
    fact_key: "BORROWER_EQUITY_PCT",
  },
  BANK_LOAN_TOTAL: {
    canonical_key: "BANK_LOAN_TOTAL",
    fact_type: "SOURCES_USES",
    fact_key: "BANK_LOAN_TOTAL",
  },

  // Optional (not required for readiness): derived from RENT_ROLL totals.
  IN_PLACE_RENT_MO: {
    canonical_key: "IN_PLACE_RENT_MO",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "IN_PLACE_RENT_MO",
  },
  OCCUPANCY_PCT: {
    canonical_key: "OCCUPANCY_PCT",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "OCCUPANCY_PCT",
  },
  VACANCY_PCT: {
    canonical_key: "VACANCY_PCT",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "VACANCY_PCT",
  },

  // Optional (not required for readiness): useful memo narrative inputs derived from T12 TTM.
  NOI_TTM: {
    canonical_key: "NOI_TTM",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "NOI_TTM",
  },
  TOTAL_INCOME_TTM: {
    canonical_key: "TOTAL_INCOME_TTM",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "TOTAL_INCOME_TTM",
  },
  OPEX_TTM: {
    canonical_key: "OPEX_TTM",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "OPEX_TTM",
  },

  // Balance sheet metrics (derived from BALANCE_SHEET facts)
  TOTAL_ASSETS: {
    canonical_key: "TOTAL_ASSETS",
    fact_type: "BALANCE_SHEET",
    fact_key: "TOTAL_ASSETS",
  },
  TOTAL_LIABILITIES: {
    canonical_key: "TOTAL_LIABILITIES",
    fact_type: "BALANCE_SHEET",
    fact_key: "TOTAL_LIABILITIES",
  },
  NET_WORTH: {
    canonical_key: "NET_WORTH",
    fact_type: "BALANCE_SHEET",
    fact_key: "NET_WORTH",
  },

  // Tax return / global cash flow metrics
  GROSS_RECEIPTS: {
    canonical_key: "GROSS_RECEIPTS",
    fact_type: "TAX_RETURN",
    fact_key: "GROSS_RECEIPTS",
  },
  DEPRECIATION_ADDBACK: {
    canonical_key: "DEPRECIATION_ADDBACK",
    fact_type: "TAX_RETURN",
    fact_key: "DEPRECIATION",
  },
  GLOBAL_CASH_FLOW: {
    canonical_key: "GLOBAL_CASH_FLOW",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "GLOBAL_CASH_FLOW",
  },

  // Personal income / PFS / GCF metrics
  PERSONAL_TOTAL_INCOME: {
    canonical_key: "PERSONAL_TOTAL_INCOME",
    fact_type: "PERSONAL_INCOME",
    fact_key: "TOTAL_PERSONAL_INCOME",
  },
  PFS_TOTAL_ASSETS: {
    canonical_key: "PFS_TOTAL_ASSETS",
    fact_type: "PERSONAL_FINANCIAL_STATEMENT",
    fact_key: "PFS_TOTAL_ASSETS",
  },
  PFS_TOTAL_LIABILITIES: {
    canonical_key: "PFS_TOTAL_LIABILITIES",
    fact_type: "PERSONAL_FINANCIAL_STATEMENT",
    fact_key: "PFS_TOTAL_LIABILITIES",
  },
  PFS_NET_WORTH: {
    canonical_key: "PFS_NET_WORTH",
    fact_type: "PERSONAL_FINANCIAL_STATEMENT",
    fact_key: "PFS_NET_WORTH",
  },
  GCF_GLOBAL_CASH_FLOW: {
    canonical_key: "GCF_GLOBAL_CASH_FLOW",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "GCF_GLOBAL_CASH_FLOW",
  },
  GCF_DSCR: {
    canonical_key: "GCF_DSCR",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "GCF_DSCR",
  },

  // Structural debt service breakdown
  ANNUAL_DEBT_SERVICE_PROPOSED: {
    canonical_key: "ANNUAL_DEBT_SERVICE_PROPOSED",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "ANNUAL_DEBT_SERVICE_PROPOSED",
  },
  ANNUAL_DEBT_SERVICE_EXISTING: {
    canonical_key: "ANNUAL_DEBT_SERVICE_EXISTING",
    fact_type: "FINANCIAL_ANALYSIS",
    fact_key: "ANNUAL_DEBT_SERVICE_EXISTING",
  },

  // Income statement computed metrics
  REVENUE: { canonical_key: "REVENUE", fact_type: "FINANCIAL_ANALYSIS", fact_key: "REVENUE" },
  COGS: { canonical_key: "COGS", fact_type: "FINANCIAL_ANALYSIS", fact_key: "COGS" },
  GROSS_PROFIT: { canonical_key: "GROSS_PROFIT", fact_type: "FINANCIAL_ANALYSIS", fact_key: "GROSS_PROFIT" },
  EBITDA: { canonical_key: "EBITDA", fact_type: "FINANCIAL_ANALYSIS", fact_key: "EBITDA" },
  NET_INCOME: { canonical_key: "NET_INCOME", fact_type: "FINANCIAL_ANALYSIS", fact_key: "NET_INCOME" },

  // Balance sheet computed metrics
  WORKING_CAPITAL: { canonical_key: "WORKING_CAPITAL", fact_type: "BALANCE_SHEET", fact_key: "WORKING_CAPITAL" },
  CURRENT_RATIO: { canonical_key: "CURRENT_RATIO", fact_type: "BALANCE_SHEET", fact_key: "CURRENT_RATIO" },
  DEBT_TO_EQUITY: { canonical_key: "DEBT_TO_EQUITY", fact_type: "BALANCE_SHEET", fact_key: "DEBT_TO_EQUITY" },
};

export const REQUIRED_CANONICAL_FACT_KEYS: Array<CanonicalFact["canonical_key"]> = [
  "CASH_FLOW_AVAILABLE",
  "ANNUAL_DEBT_SERVICE",
  "EXCESS_CASH_FLOW",
  "DSCR",
  "DSCR_STRESSED_300BPS",
  "COLLATERAL_GROSS_VALUE",
  "COLLATERAL_NET_VALUE",
  "COLLATERAL_DISCOUNTED_VALUE",
  "COLLATERAL_DISCOUNTED_COVERAGE",
  "LTV_GROSS",
  "LTV_NET",
  "TOTAL_PROJECT_COST",
  "BORROWER_EQUITY",
  "BORROWER_EQUITY_PCT",
  "BANK_LOAN_TOTAL",
];
