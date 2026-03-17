export type CanonicalMemoNumber = number | null;

export type CanonicalMetricSource = {
  source: string;
  updated_at: string | null;
};

export type CanonicalMetricValue = CanonicalMetricSource & {
  value: CanonicalMemoNumber;
};

// ── Debt Coverage Row (one period: Interim, Year 1, Year 2, etc.) ─────────
export type DebtCoverageRow = {
  label: string;               // "Interim", "Year 1", "Year 2"
  period_end: string;          // "7/31/2025", "12/31/2025"
  months: number;              // 6, 12, 12
  revenue: CanonicalMemoNumber;
  net_income: CanonicalMemoNumber;
  addback_rent: CanonicalMemoNumber;
  addback_interest: CanonicalMemoNumber;
  addback_depreciation: CanonicalMemoNumber;
  addback_officer_salary: CanonicalMemoNumber;
  deduct_payroll: CanonicalMemoNumber;
  deduct_officer_draw: CanonicalMemoNumber;
  cash_flow_available: CanonicalMemoNumber;
  debt_service: CanonicalMemoNumber;
  excess_cash_flow: CanonicalMemoNumber;
  dscr: CanonicalMemoNumber;
  debt_service_stressed: CanonicalMemoNumber;
  dscr_stressed: CanonicalMemoNumber;
  is_projection: boolean;
};

// ── Income Statement Row (one period) ────────────────────────────────────
export type IncomeStatementRow = {
  label: string;
  period_end: string;
  months: number;
  revenue: CanonicalMemoNumber;
  revenue_pct: CanonicalMemoNumber;
  cogs: CanonicalMemoNumber;
  cogs_pct: CanonicalMemoNumber;
  gross_profit: CanonicalMemoNumber;
  gross_margin: CanonicalMemoNumber;
  operating_expenses: CanonicalMemoNumber;
  opex_pct: CanonicalMemoNumber;
  operating_income: CanonicalMemoNumber;
  operating_margin: CanonicalMemoNumber;
  net_income: CanonicalMemoNumber;
  net_margin: CanonicalMemoNumber;
  ebitda: CanonicalMemoNumber;
  depreciation: CanonicalMemoNumber;
  interest_expense: CanonicalMemoNumber;
  is_projection: boolean;
};

// ── Ratio Analysis Row ────────────────────────────────────────────────────
export type RatioAnalysisRow = {
  metric: string;
  value: CanonicalMemoNumber;
  industry_avg: CanonicalMemoNumber | null;
  industry_source: string | null;
  unit: "ratio" | "percent" | "days" | "times" | "currency";
  period_label: string;
};

// ── Collateral Line Item ──────────────────────────────────────────────────
export type CollateralLineItem = {
  description: string;
  address?: string;
  gross_value: CanonicalMemoNumber;
  advance_rate_pct: CanonicalMemoNumber;
  net_value: CanonicalMemoNumber;
  prior_liens: CanonicalMemoNumber;
  net_equity: CanonicalMemoNumber;
  lien_position: string;
  is_existing: boolean;
};

// ── Global Cash Flow Table Row ────────────────────────────────────────────
export type GlobalCFRow = {
  label: string;
  period_end: string;
  personal_cash_flow: CanonicalMemoNumber;
  business_cash_flow: CanonicalMemoNumber;
  total_cash_flow: CanonicalMemoNumber;
  personal_expenses: CanonicalMemoNumber;
  existing_debt_service: CanonicalMemoNumber;
  proposed_debt_service: CanonicalMemoNumber;
  total_obligations: CanonicalMemoNumber;
  global_dscr: CanonicalMemoNumber;
  excess_cash: CanonicalMemoNumber;
};

// ── Personal Budget Analysis per Guarantor ────────────────────────────────
export type GuarantorBudget = {
  owner_entity_id: string;
  name: string | null;
  pfs_date: string | null;
  credit_score: CanonicalMemoNumber;
  post_closing_liquidity: CanonicalMemoNumber;
  // Assets
  cash_equivalents: CanonicalMemoNumber;
  stocks_bonds: CanonicalMemoNumber;
  primary_residence_value: CanonicalMemoNumber;
  autos: CanonicalMemoNumber;
  retirement: CanonicalMemoNumber;
  total_assets: CanonicalMemoNumber;
  // Liabilities
  revolving_debt: CanonicalMemoNumber;
  installment_debt: CanonicalMemoNumber;
  real_estate_debt: CanonicalMemoNumber;
  total_liabilities: CanonicalMemoNumber;
  net_worth: CanonicalMemoNumber;
  // Monthly income
  monthly_gross_salary: CanonicalMemoNumber;
  monthly_rental_income: CanonicalMemoNumber;
  monthly_other_income: CanonicalMemoNumber;
  total_monthly_income: CanonicalMemoNumber;
  annual_income: CanonicalMemoNumber;
  // Monthly expenses
  monthly_mortgage: CanonicalMemoNumber;
  monthly_heloc: CanonicalMemoNumber;
  monthly_auto_installment: CanonicalMemoNumber;
  monthly_revolving: CanonicalMemoNumber;
  monthly_living: CanonicalMemoNumber;
  monthly_taxes: CanonicalMemoNumber;
  monthly_misc: CanonicalMemoNumber;
  total_monthly_expenses: CanonicalMemoNumber;
  annual_expenses: CanonicalMemoNumber;
  net_discretionary_income: CanonicalMemoNumber;
};

export type CanonicalCreditMemoV1 = {
  version: "canonical_v1";
  deal_id: string;
  bank_id: string;
  generated_at: string;

  // ── HEADER ──────────────────────────────────────────────────────────────
  header: {
    deal_name: string;
    borrower_name: string;
    guarantors: string[];
    lender_name: string;
    prepared_by: string;
    underwriting_assistance: string | null;
    date: string;
    request_summary: string;
    action_type: "Original Action" | "1st Reconsideration" | "Further Reconsideration";
  };

  // ── KEY TRANSACTION METRICS (top box) ───────────────────────────────────
  key_metrics: {
    loan_amount: CanonicalMetricValue;
    product: string;
    rate_summary: string;
    rate_index: string;
    rate_base_pct: CanonicalMemoNumber;
    rate_spread_pct: CanonicalMemoNumber;
    rate_initial_pct: CanonicalMemoNumber;
    rate_type: "Fixed" | "Variable" | null;
    term_months: CanonicalMemoNumber;
    amort_months: CanonicalMemoNumber;
    monthly_payment: CanonicalMemoNumber;
    guaranty_pct: CanonicalMemoNumber;
    prepayment_penalty: string;
    dscr_uw: CanonicalMetricValue;
    dscr_stressed: CanonicalMetricValue;
    ltv_gross: CanonicalMetricValue;
    ltv_net: CanonicalMetricValue;
    discounted_coverage: CanonicalMetricValue;
    debt_yield: CanonicalMetricValue;
    cap_rate: CanonicalMetricValue;
    stabilization_status: string;
    sba_sop: string | null;
  };

  // ── SOURCES & USES ───────────────────────────────────────────────────────
  sources_uses: {
    total_project_cost: CanonicalMetricValue;
    borrower_equity: CanonicalMetricValue;
    borrower_equity_pct: CanonicalMetricValue;
    bank_loan_total: CanonicalMetricValue;
    sources: Array<{ description: string; amount: CanonicalMetricValue }>;
    uses: Array<{ description: string; amount: CanonicalMetricValue }>;
    equity_source_description: string;
  };

  // ── ELIGIBILITY ──────────────────────────────────────────────────────────
  eligibility: {
    naics_code: string | null;
    naics_description: string | null;
    sba_size_standard_revenue: CanonicalMemoNumber;
    applicant_revenue: CanonicalMemoNumber;
    employee_count: CanonicalMemoNumber;
    is_exporter: boolean | null;
    franchise_name: string | null;
    naics_sba_stats: {
      three_yr_approval_amount: CanonicalMemoNumber;
      three_yr_approval_count: CanonicalMemoNumber;
      ten_yr_paid_in_full_pct: CanonicalMemoNumber;
      ten_yr_pct_prepaid_first_5yr: CanonicalMemoNumber;
      ten_yr_cumulative_chargeoff_pct: CanonicalMemoNumber;
      ten_yr_annualized_chargeoff_pct: CanonicalMemoNumber;
      ten_yr_cumulative_default_pct: CanonicalMemoNumber;
      ten_yr_annualized_default_pct: CanonicalMemoNumber;
      data_source: string;
    } | null;
    credit_available_elsewhere: string;
    benefit_to_small_business: string;
  };

  // ── COLLATERAL ───────────────────────────────────────────────────────────
  collateral: {
    property_description: string;
    property_address: string;
    line_items: CollateralLineItem[];
    total_gross: CanonicalMemoNumber;
    total_net: CanonicalMemoNumber;
    total_net_equity: CanonicalMemoNumber;
    loan_amount: CanonicalMemoNumber;
    discounted_coverage: CanonicalMetricValue;
    ltv_gross: CanonicalMetricValue;
    ltv_net: CanonicalMetricValue;
    gross_value: CanonicalMetricValue;
    net_value: CanonicalMetricValue;
    discounted_value: CanonicalMetricValue;
    valuation: {
      as_is: CanonicalMetricValue;
      stabilized: CanonicalMetricValue;
    };
    collateral_coverage: CanonicalMetricValue;
    stabilization_status: string;
    is_adequate: boolean | null;
    life_insurance_required: boolean;
    life_insurance_amount: CanonicalMemoNumber;
    life_insurance_insured: string | null;
  };

  // ── BUSINESS & INDUSTRY ANALYSIS ─────────────────────────────────────────
  business_summary: {
    business_description: string;
    date_established: string | null;
    years_in_operation: CanonicalMemoNumber;
    revenue_mix: string;
    seasonality: string;
    geography: string;
    marketing_channels: string[];
    competitive_advantages: string;
    vision: string;
  };

  business_industry_analysis: {
    industry_overview: string;
    market_dynamics: string;
    competitive_positioning: string;
    regulatory_environment: string;
    risk_indicators: Array<{
      category: string;
      level: "low" | "medium" | "high";
      summary: string;
    }>;
    research_coverage: {
      missions_count: number;
      facts_count: number;
      inferences_count: number;
      sources_count: number;
      compiled_at: string | null;
    };
  } | null;

  // ── MANAGEMENT QUALIFICATIONS ─────────────────────────────────────────────
  management_qualifications: {
    principals: Array<{
      name: string;
      ownership_pct: CanonicalMemoNumber;
      title: string | null;
      bio: string;
      years_experience: CanonicalMemoNumber;
      prior_roles: string[];
      other_income_sources: string | null;
    }>;
  };

  // ── FINANCIAL ANALYSIS ───────────────────────────────────────────────────
  financial_analysis: {
    income_analysis: string;
    noi: CanonicalMetricValue;
    debt_service: CanonicalMetricValue;
    cash_flow_available: CanonicalMetricValue;
    excess_cash_flow: CanonicalMetricValue;
    dscr: CanonicalMetricValue;
    dscr_stressed: CanonicalMetricValue;
    debt_yield: CanonicalMetricValue;
    cap_rate: CanonicalMetricValue;
    revenue: CanonicalMetricValue;
    ebitda: CanonicalMetricValue;
    net_income: CanonicalMetricValue;
    working_capital: CanonicalMetricValue;
    current_ratio: CanonicalMetricValue;
    debt_to_equity: CanonicalMetricValue;
    // Multi-period tables
    debt_coverage_table: DebtCoverageRow[];
    income_statement_table: IncomeStatementRow[];
    ratio_analysis: RatioAnalysisRow[];
    // Breakeven
    breakeven: {
      required_revenue: CanonicalMemoNumber;
      required_cogs: CanonicalMemoNumber;
      fixed_expenses: CanonicalMemoNumber;
      ebitda_at_breakeven: CanonicalMemoNumber;
      revenue_cushion_pct: CanonicalMemoNumber;
      narrative: string;
    };
    repayment_notes: string[];
    projection_feasibility: string;
  };

  // ── GLOBAL CASH FLOW ────────────────────────────────────────────────────
  global_cash_flow: {
    global_cash_flow: CanonicalMetricValue;
    global_dscr: CanonicalMetricValue;
    cash_available: CanonicalMetricValue;
    personal_debt_service: CanonicalMetricValue;
    living_expenses: CanonicalMetricValue;
    total_obligations: CanonicalMetricValue;
    global_cf_table: GlobalCFRow[];
  };

  // ── PERSONAL FINANCIAL STATEMENTS ───────────────────────────────────────
  personal_financial_statements: GuarantorBudget[];

  // ── EXECUTIVE SUMMARY ───────────────────────────────────────────────────
  executive_summary: {
    narrative: string;
  };

  // ── TRANSACTION OVERVIEW ─────────────────────────────────────────────────
  transaction_overview: {
    loan_request: {
      purpose: string;
      term_months: CanonicalMemoNumber;
      amount: CanonicalMemoNumber;
      product: string;
    };
  };

  // ── BORROWER & SPONSOR ───────────────────────────────────────────────────
  borrower_sponsor: {
    background: string;
    experience: string;
    guarantor_strength: string;
    sponsors: Array<{
      owner_entity_id: string;
      name: string | null;
      total_personal_income: CanonicalMetricValue;
      wages_w2: CanonicalMetricValue;
      sched_e_net: CanonicalMetricValue;
      k1_ordinary_income: CanonicalMetricValue;
      pfs_total_assets: CanonicalMetricValue;
      pfs_total_liabilities: CanonicalMetricValue;
      pfs_net_worth: CanonicalMetricValue;
    }>;
  };

  // ── RISK FACTORS ─────────────────────────────────────────────────────────
  risk_factors: Array<{
    risk: string;
    severity: "low" | "medium" | "high";
    mitigants: string[];
  }>;

  // ── STRENGTHS & WEAKNESSES ───────────────────────────────────────────────
  strengths_weaknesses: {
    strengths: Array<{ point: string; detail: string | null }>;
    weaknesses: Array<{ point: string; mitigant: string | null }>;
  };

  // ── POLICY EXCEPTIONS ────────────────────────────────────────────────────
  policy_exceptions: Array<{
    exception: string;
    rationale: string;
  }>;

  // ── PROPOSED TERMS ───────────────────────────────────────────────────────
  proposed_terms: {
    product: string;
    rate: {
      all_in_rate: CanonicalMemoNumber;
      index: string;
      margin_bps: CanonicalMemoNumber;
    };
    rationale: string;
  };

  // ── CONDITIONS ───────────────────────────────────────────────────────────
  conditions: {
    precedent: string[];
    ongoing: string[];
    insurance: string[];
  };

  // ── RECOMMENDATION ───────────────────────────────────────────────────────
  recommendation: {
    verdict: "approve" | "caution" | "decline_risk" | "pending";
    headline: string;
    risk_grade: string;
    risk_score: number | null;
    confidence: number | null;
    rationale: string[];
    key_drivers: string[];
    mitigants: string[];
    exceptions: string[];
  };

  // ── META ─────────────────────────────────────────────────────────────────
  meta: {
    notes: string[];
    readiness: {
      status: "pending" | "partial" | "ready" | "error";
      last_generated_at: string | null;
      missing_spreads: string[];
      missing_metrics: string[];
    };
    data_completeness: {
      deal: { total: number; populated: number; status: string };
      personal: { total: number; populated: number; status: string };
      global: { total: number; populated: number; status: string };
    };
    spreads: Array<{
      spread_type: string;
      status: string;
      updated_at?: string | null;
    }>;
  };
};
