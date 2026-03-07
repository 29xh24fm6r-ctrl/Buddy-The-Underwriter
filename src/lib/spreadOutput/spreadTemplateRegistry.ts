/**
 * Spread Template Registry — deal-type-specific configurations
 *
 * Each template defines ratio groups, line item order, policy overrides,
 * and default covenant suggestions for a deal type.
 * Pure data — no DB, no server imports.
 */

import type { DealType } from "./types";

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export interface SpreadTemplate {
  deal_type: DealType;
  primary_ratio_groups: TemplateRatioGroup[];
  line_item_order: TemplateLineItem[];
  policy_threshold_overrides: Record<string, number>;
  covenant_templates: TemplateCovenantSuggestion[];
}

export interface TemplateRatioGroup {
  group_name: string;
  ratio_keys: string[];
}

export interface TemplateLineItem {
  canonical_key: string;
  label: string;
  category: "revenue" | "cogs" | "expense" | "ebitda" | "debt_service" | "ratio" | "balance_sheet";
}

export interface TemplateCovenantSuggestion {
  covenant_type: string;
  description: string;
  canonical_key: string;
  threshold_offset: number; // subtract from policy minimum
  frequency: "monthly" | "quarterly" | "annually";
}

// ---------------------------------------------------------------------------
// Balance Sheet line items (shared across all templates)
// ---------------------------------------------------------------------------

const BALANCE_SHEET_ITEMS: TemplateLineItem[] = [
  { canonical_key: "SL_CASH",                    label: "Cash & Equivalents",        category: "balance_sheet" },
  { canonical_key: "SL_AR_GROSS",                 label: "Accounts Receivable",       category: "balance_sheet" },
  { canonical_key: "SL_INVENTORY",                label: "Inventory",                 category: "balance_sheet" },
  { canonical_key: "SL_PPE_GROSS",                label: "PP&E (Gross)",              category: "balance_sheet" },
  { canonical_key: "SL_ACCUMULATED_DEPRECIATION", label: "Accumulated Depreciation",  category: "balance_sheet" },
  { canonical_key: "SL_LAND",                     label: "Land",                      category: "balance_sheet" },
  { canonical_key: "SL_TOTAL_ASSETS",             label: "Total Assets",              category: "balance_sheet" },
  { canonical_key: "SL_ACCOUNTS_PAYABLE",         label: "Accounts Payable",          category: "balance_sheet" },
  { canonical_key: "SL_MORTGAGES_NOTES_BONDS",    label: "Mortgages / Notes Payable", category: "balance_sheet" },
  { canonical_key: "SL_TOTAL_LIABILITIES",        label: "Total Liabilities",         category: "balance_sheet" },
  { canonical_key: "SL_RETAINED_EARNINGS",        label: "Retained Earnings",         category: "balance_sheet" },
  { canonical_key: "SL_TOTAL_EQUITY",             label: "Total Equity",              category: "balance_sheet" },
];

// ---------------------------------------------------------------------------
// C&I Template
// ---------------------------------------------------------------------------

const C_AND_I: SpreadTemplate = {
  deal_type: "c_and_i",
  primary_ratio_groups: [
    {
      group_name: "Coverage",
      ratio_keys: ["DSCR", "ratio_dscr_final", "ratio_fccr", "FCCR"],
    },
    {
      group_name: "Leverage",
      ratio_keys: ["DEBT_TO_EBITDA", "ratio_debt_ebitda", "DEBT_TO_EQUITY", "ratio_debt_equity"],
    },
    {
      group_name: "Efficiency",
      ratio_keys: ["DSO", "ratio_dso", "DIO", "ratio_dio", "DPO", "ratio_dpo", "ratio_ccc"],
    },
    {
      group_name: "Liquidity",
      ratio_keys: ["CURRENT_RATIO", "ratio_current", "QUICK_RATIO", "ratio_quick"],
    },
    {
      group_name: "Profitability",
      ratio_keys: ["GROSS_MARGIN", "ratio_gross_margin_pct", "EBITDA_MARGIN", "ratio_ebitda_margin_pct"],
    },
  ],
  line_item_order: [
    { canonical_key: "GROSS_RECEIPTS", label: "Gross Revenue", category: "revenue" },
    { canonical_key: "COGS", label: "Cost of Goods Sold", category: "cogs" },
    { canonical_key: "GROSS_PROFIT", label: "Gross Profit", category: "revenue" },
    { canonical_key: "TOTAL_OPERATING_EXPENSES", label: "Total Operating Expenses", category: "expense" },
    { canonical_key: "EBITDA", label: "EBITDA", category: "ebitda" },
    { canonical_key: "DEPRECIATION", label: "Depreciation Add-back", category: "ebitda" },
    { canonical_key: "cf_qoe_adjustment", label: "QoE Adjustments", category: "ebitda" },
    { canonical_key: "cf_owner_benefit_addbacks", label: "Owner Benefit Add-backs", category: "ebitda" },
    { canonical_key: "cf_ebitda_adjusted", label: "Adjusted EBITDA", category: "ebitda" },
    { canonical_key: "INTEREST_EXPENSE", label: "Interest Expense", category: "debt_service" },
    { canonical_key: "TAXES", label: "Taxes", category: "expense" },
    { canonical_key: "cf_ncads", label: "Net Cash Available for Debt Service", category: "debt_service" },
    { canonical_key: "cf_annual_debt_service", label: "Annual Debt Service", category: "debt_service" },
    { canonical_key: "DSCR", label: "DSCR", category: "ratio" },
    ...BALANCE_SHEET_ITEMS,
  ],
  policy_threshold_overrides: {},
  covenant_templates: [
    {
      covenant_type: "Annual DSCR test",
      description: "DSCR tested annually on audited/reviewed financials",
      canonical_key: "DSCR",
      threshold_offset: 0.05,
      frequency: "annually",
    },
    {
      covenant_type: "Current ratio minimum",
      description: "Current ratio tested quarterly",
      canonical_key: "CURRENT_RATIO",
      threshold_offset: 0.10,
      frequency: "quarterly",
    },
  ],
};

// ---------------------------------------------------------------------------
// CRE Investor Template
// ---------------------------------------------------------------------------

const CRE_INVESTOR: SpreadTemplate = {
  deal_type: "cre_investor",
  primary_ratio_groups: [
    {
      group_name: "Coverage",
      ratio_keys: ["cre_dscr", "ratio_noi_dscr", "DSCR", "ratio_dscr_final"],
    },
    {
      group_name: "Returns",
      ratio_keys: ["cre_debt_yield_pct", "cre_cap_rate_pct"],
    },
    {
      group_name: "Leverage",
      ratio_keys: ["cre_ltv_pct", "LTV", "ratio_ltv"],
    },
    {
      group_name: "Occupancy",
      ratio_keys: ["cre_breakeven_occ_pct", "cre_occupancy_pct"],
    },
  ],
  line_item_order: [
    { canonical_key: "cre_gross_potential_rent", label: "Gross Potential Rent", category: "revenue" },
    { canonical_key: "cre_vacancy_loss", label: "Vacancy Loss", category: "revenue" },
    { canonical_key: "cre_egi", label: "Effective Gross Income", category: "revenue" },
    { canonical_key: "TOTAL_OPERATING_EXPENSES", label: "Total Operating Expenses", category: "expense" },
    { canonical_key: "cre_noi", label: "Net Operating Income", category: "ebitda" },
    { canonical_key: "cf_annual_debt_service", label: "Annual Debt Service", category: "debt_service" },
    { canonical_key: "cre_dscr", label: "NOI DSCR", category: "ratio" },
    ...BALANCE_SHEET_ITEMS,
  ],
  policy_threshold_overrides: {
    dscr_minimum: 1.20,
    ltv_maximum: 0.75,
  },
  covenant_templates: [
    {
      covenant_type: "Annual DSCR test",
      description: "NOI DSCR tested annually based on property financials",
      canonical_key: "cre_dscr",
      threshold_offset: 0.05,
      frequency: "annually",
    },
    {
      covenant_type: "Minimum occupancy",
      description: "Maintain minimum occupancy rate",
      canonical_key: "cre_occupancy_pct",
      threshold_offset: 10,
      frequency: "quarterly",
    },
  ],
};

// ---------------------------------------------------------------------------
// CRE Owner-Occupied Template
// ---------------------------------------------------------------------------

const CRE_OWNER_OCCUPIED: SpreadTemplate = {
  deal_type: "cre_owner_occupied",
  primary_ratio_groups: [
    {
      group_name: "Coverage",
      ratio_keys: ["DSCR", "ratio_dscr_final", "ratio_fccr", "FCCR"],
    },
    {
      group_name: "Leverage",
      ratio_keys: ["cre_ltv_pct", "LTV", "DEBT_TO_EBITDA", "ratio_debt_ebitda"],
    },
    {
      group_name: "Liquidity",
      ratio_keys: ["CURRENT_RATIO", "ratio_current", "QUICK_RATIO", "ratio_quick"],
    },
    {
      group_name: "Profitability",
      ratio_keys: ["EBITDA_MARGIN", "ratio_ebitda_margin_pct", "GROSS_MARGIN"],
    },
  ],
  line_item_order: [...C_AND_I.line_item_order],
  policy_threshold_overrides: {
    ltv_maximum: 0.80,
  },
  covenant_templates: C_AND_I.covenant_templates,
};

// ---------------------------------------------------------------------------
// CRE Construction Template
// ---------------------------------------------------------------------------

const CRE_CONSTRUCTION: SpreadTemplate = {
  deal_type: "cre_construction",
  primary_ratio_groups: [
    {
      group_name: "Feasibility",
      ratio_keys: ["cre_ltc_pct", "cre_ltv_pct", "LTV"],
    },
    {
      group_name: "Projected Coverage",
      ratio_keys: ["cre_dscr", "DSCR", "cre_debt_yield_pct"],
    },
    {
      group_name: "Liquidity",
      ratio_keys: ["CURRENT_RATIO", "ratio_current"],
    },
  ],
  line_item_order: [...CRE_INVESTOR.line_item_order],
  policy_threshold_overrides: {
    ltc_maximum: 0.80,
    ltv_maximum: 0.70,
  },
  covenant_templates: [
    {
      covenant_type: "Monthly draw inspection",
      description: "Independent draw inspection required before each disbursement",
      canonical_key: "cre_ltc_pct",
      threshold_offset: 0,
      frequency: "monthly",
    },
  ],
};

// ---------------------------------------------------------------------------
// SBA 7(a) Template
// ---------------------------------------------------------------------------

const SBA_7A: SpreadTemplate = {
  deal_type: "sba_7a",
  primary_ratio_groups: [
    {
      group_name: "Coverage",
      ratio_keys: ["DSCR", "ratio_dscr_final", "ratio_fccr", "FCCR"],
    },
    {
      group_name: "Leverage",
      ratio_keys: ["DEBT_TO_EBITDA", "ratio_debt_ebitda", "DEBT_TO_EQUITY"],
    },
    {
      group_name: "Liquidity",
      ratio_keys: ["CURRENT_RATIO", "ratio_current"],
    },
    {
      group_name: "Profitability",
      ratio_keys: ["EBITDA_MARGIN", "GROSS_MARGIN"],
    },
  ],
  line_item_order: [...C_AND_I.line_item_order],
  policy_threshold_overrides: {
    dscr_minimum: 1.15,
  },
  covenant_templates: C_AND_I.covenant_templates,
};

// ---------------------------------------------------------------------------
// Professional Practice Template
// ---------------------------------------------------------------------------

const PROFESSIONAL_PRACTICE: SpreadTemplate = {
  deal_type: "professional_practice",
  primary_ratio_groups: [
    {
      group_name: "Coverage",
      ratio_keys: ["DSCR", "ratio_dscr_final", "ratio_fccr", "FCCR"],
    },
    {
      group_name: "Practice Metrics",
      ratio_keys: ["ratio_revenue_per_provider", "ratio_collections_ratio", "ratio_overhead_ratio"],
    },
    {
      group_name: "Leverage",
      ratio_keys: ["DEBT_TO_EBITDA", "ratio_debt_ebitda"],
    },
    {
      group_name: "Liquidity",
      ratio_keys: ["CURRENT_RATIO", "ratio_current"],
    },
  ],
  line_item_order: [...C_AND_I.line_item_order],
  policy_threshold_overrides: {},
  covenant_templates: [
    ...C_AND_I.covenant_templates,
    {
      covenant_type: "Key-man life insurance",
      description: "Assignment of key-man life insurance policy",
      canonical_key: "ratio_revenue_per_provider",
      threshold_offset: 0,
      frequency: "annually",
    },
  ],
};

// ---------------------------------------------------------------------------
// Agriculture Template
// ---------------------------------------------------------------------------

const AGRICULTURE: SpreadTemplate = {
  deal_type: "agriculture",
  primary_ratio_groups: [
    {
      group_name: "Coverage",
      ratio_keys: ["DSCR", "ratio_dscr_final"],
    },
    {
      group_name: "Leverage",
      ratio_keys: ["DEBT_TO_EBITDA", "ratio_debt_ebitda", "DEBT_TO_EQUITY"],
    },
    {
      group_name: "Liquidity",
      ratio_keys: ["CURRENT_RATIO", "ratio_current", "QUICK_RATIO"],
    },
    {
      group_name: "Profitability",
      ratio_keys: ["GROSS_MARGIN", "EBITDA_MARGIN", "NET_MARGIN"],
    },
  ],
  line_item_order: [...C_AND_I.line_item_order],
  policy_threshold_overrides: {
    dscr_minimum: 1.15,
    ltv_maximum: 0.65,
  },
  covenant_templates: [
    {
      covenant_type: "Annual DSCR test",
      description: "DSCR tested annually on tax returns",
      canonical_key: "DSCR",
      threshold_offset: 0.05,
      frequency: "annually",
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, SpreadTemplate> = {
  c_and_i: C_AND_I,
  cre_investor: CRE_INVESTOR,
  cre_owner_occupied: CRE_OWNER_OCCUPIED,
  cre_construction: CRE_CONSTRUCTION,
  sba_7a: SBA_7A,
  professional_practice: PROFESSIONAL_PRACTICE,
  agriculture: AGRICULTURE,
};

export function getSpreadTemplate(dealType: DealType): SpreadTemplate {
  return TEMPLATES[dealType] ?? C_AND_I;
}

export function getSupportedDealTypes(): DealType[] {
  return Object.keys(TEMPLATES) as DealType[];
}
