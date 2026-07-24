export type CanonicalMemoNumber = number | null;

export type CanonicalMetricSource = {
  source: string;
  updated_at: string | null;
};

export type CanonicalMetricValue = CanonicalMetricSource & {
  value: CanonicalMemoNumber;
  /**
   * SPEC-DSCR-PRELIMINARY-LABEL-RENDERING-1: when true, the metric's denominator is
   * not yet committee-final (e.g. global obligations unconfirmed / existing debt not
   * on file). `caveat` is the human-readable reason rendered next to the value.
   */
  preliminary?: boolean;
  caveat?: string | null;
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

// ── New Debt Row (one existing-debt-schedule instrument surviving this
// transaction — not being refinanced, retained alongside the new loan) ────
// Source: deal_existing_debt_schedule, filtered exactly like
// loadDealInstruments.ts / computeTotalDebtService.ts filter it for the
// SAME purpose (total debt service alongside the proposed loan):
// is_being_refinanced=false AND included_in_global=true.
export type NewDebtRow = {
  lender: string | null;
  amount: CanonicalMemoNumber;
  rate: CanonicalMemoNumber;
  term_months: CanonicalMemoNumber;
  monthly_payment: CanonicalMemoNumber;
  annual_debt_service: CanonicalMemoNumber;
};

// ── Balance Sheet Row (one period) ────────────────────────────────────────
// Built from SL_ prefixed facts in deal_financial_facts.
// Source: Schedule L (tax returns) or direct balance sheet extraction.
// This type is intentionally flat — all fields are nullable so partial
// extraction (e.g. only total assets / total liabilities) still renders.
export type BalanceSheetRow = {
  period_end: string;           // "2024-12-31"
  // Assets
  cash_and_equivalents: CanonicalMemoNumber;
  accounts_receivable: CanonicalMemoNumber;
  inventory: CanonicalMemoNumber;
  other_current_assets: CanonicalMemoNumber;
  total_current_assets: CanonicalMemoNumber;
  ppe_gross: CanonicalMemoNumber;
  accumulated_depreciation: CanonicalMemoNumber;
  ppe_net: CanonicalMemoNumber;   // derived: ppe_gross - accumulated_depreciation
  other_assets: CanonicalMemoNumber;
  total_assets: CanonicalMemoNumber;
  // Liabilities
  accounts_payable: CanonicalMemoNumber;
  other_current_liabilities: CanonicalMemoNumber;
  total_current_liabilities: CanonicalMemoNumber;
  mortgages_notes_bonds: CanonicalMemoNumber;   // long-term debt / notes payable
  other_long_term_liabilities: CanonicalMemoNumber;
  total_liabilities: CanonicalMemoNumber;
  // Equity
  retained_earnings: CanonicalMemoNumber;
  total_equity: CanonicalMemoNumber;
  // Balancing check: total_liabilities + total_equity (should equal total_assets)
  liabilities_plus_equity: CanonicalMemoNumber;
};

// ── AR Borrowing Base (embedded in collateral section) ───────────────────

export type ArAgingBucketRow = {
  bucket: string;           // "Current", "1-30", "31-60", "61-90", "91+"
  amount: CanonicalMemoNumber;
  pct_of_total: CanonicalMemoNumber;
};

export type ArBorrowingBaseSection = {
  as_of_date: string | null;
  total_ar: CanonicalMemoNumber;
  eligible_ar: CanonicalMemoNumber;
  ineligible_ar: CanonicalMemoNumber;
  advance_rate: CanonicalMemoNumber;
  borrowing_base_value: CanonicalMemoNumber;
  borrowing_base_availability: CanonicalMemoNumber;
  aging_buckets: ArAgingBucketRow[];
  collateral_coverage_narrative: string;
};

// ── Ratio Analysis Row ────────────────────────────────────────────────────
export type RatioCategory =
  | "Liquidity"
  | "Leverage"
  | "Coverage"
  | "Profitability"
  | "Activity";

export type RatioAssessment = "Strong" | "Adequate" | "Weak" | "N/A";

export type RatioAnalysisRow = {
  metric: string;
  category?: RatioCategory;
  value: CanonicalMemoNumber;
  industry_avg: CanonicalMemoNumber | null;
  industry_source: string | null;
  unit: "ratio" | "percent" | "days" | "times" | "currency";
  period_label: string;
  /** Strong/Adequate/Weak/N/A — short verdict for committee skim. */
  assessment?: RatioAssessment;
  /** One-sentence interpretation of what this value signals. */
  interpretation?: string;
  /** Benchmark context — institutional minimums, SBA thresholds, peer averages. */
  benchmark_note?: string | null;
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

// Phase 81: Committee certification status
// Phase 82: Evidence coverage fields added
export type CommitteeCertification = {
  isCommitteeEligible: boolean;
  trustGrade: string | null;
  subjectLocked: boolean;
  renderMode: "committee" | "internal_diagnostic";
  blockers: string[];
  /** Phase 82: 0.0–1.0 ratio of sections with at least one evidence row; null if no memo generated yet */
  evidenceSupportRatio: number | null;
  /** Phase 82: section_keys with evidence_count === 0 */
  unsupportedSections: string[];
};

export type CanonicalCreditMemoV1 = {
  version: "canonical_v1";
  deal_id: string;
  bank_id: string;
  generated_at: string;
  // Phase 81: Committee certification
  certification?: CommitteeCertification;

  // ── CREDIT OFFICER EXECUTIVE TAKEAWAY ─────────────────────────────────
  executive_takeaway?: string[];

  // ── HEADER ──────────────────────────────────────────────────────────────
  header: {
    deal_name: string;
    borrower_name: string;
    /** Legacy: simple name list. Prefer guarantor_details when available. */
    guarantors: string[];
    guarantor_details?: Array<{
      name: string;
      type: "individual" | "entity";
      role: string;
      ownership_pct: number | null;
      verification_status: "verified" | "pending_verification";
    }>;
    pending_guarantor_items?: string[];
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

    // AR / Borrowing Base (populated when collateral type is AR/LOC)
    ar_borrowing_base: ArBorrowingBaseSection | null;
  };

  // ── BANKER CONTEXT (live render of banker notes) ─────────────────────────
  banker_context?: {
    banker_notes: string | null;
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
    // ACTIVATION: enriched fields from deal_borrower_story
    products_services?: string | null;
    customers?: string | null;
    customer_concentration?: string | null;
    key_risks?: string | null;
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
    // BIE v3 fields — populated when version 3 narrative exists
    credit_thesis?: string;
    structure_implications?: string[];
    underwriting_questions?: string[];
    monitoring_triggers?: string[];
    contradictions?: string[];
    management_intelligence?: string;
    litigation_and_risk?: string;
    transaction_analysis?: string;
    three_five_year_outlook?: string;
    research_quality_score?: "Strong" | "Moderate" | "Limited";
    sources_count_bie?: number;
    /** Elite: industry risk and borrower positioning narrative for credit judgment */
    industry_risk_positioning?: string | null;
  } | null;

  // ── MANAGEMENT QUALIFICATIONS ─────────────────────────────────────────────
  management_qualifications: {
    principals: Array<{
      id: string;
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
    // Multi-period tables — all built from deal_financial_facts (spread-independent)
    debt_coverage_table: DebtCoverageRow[];
    income_statement_table: IncomeStatementRow[];
    // Balance sheet: built from SL_ keyed facts (Schedule L / balance sheet extraction)
    // Always populated as long as documents have been extracted — never requires
    // the BALANCE_SHEET spread row in deal_spreads to exist.
    balance_sheet_table: BalanceSheetRow[];
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
    /** Elite: narrative explaining GCF proxy status when formal exhibit is incomplete */
    gcf_proxy_narrative?: string | null;
    /** Elite: structured GCF status for institutional rendering */
    gcf_status?: "formal_complete" | "proxy_with_pfs" | "pending_pfs";
    /** Elite: guarantor support summary for institutional rendering */
    guarantor_support?: {
      guarantor_name: string | null;
      annual_personal_income: CanonicalMemoNumber;
      total_assets: CanonicalMemoNumber;
      total_liabilities: CanonicalMemoNumber;
      net_worth: CanonicalMemoNumber;
      liquidity: CanonicalMemoNumber;
      known_limitations: string[];
      credit_view: string;
      required_follow_up: string[];
      income_reconciliation?: {
        selected_income_for_gcf: number | null;
        selected_income_source: string;
        alternate_income_values: Array<{ value: number; source: string; label: string }>;
        reconciliation_note: string | null;
        warning_level: string;
      };
    } | null;
  };

  // ── PERSONAL FINANCIAL STATEMENTS ───────────────────────────────────────
  personal_financial_statements: GuarantorBudget[];

  // ── NEW DEBT (existing-debt-schedule instruments surviving this
  // transaction) ───────────────────────────────────────────────────────────
  new_debt: { rows: NewDebtRow[] };

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

  // ── STRESS TESTING (Phase 90 Part A) ─────────────────────────────────────
  stress_testing: import("./buildStressTestTable").StressTestTable | null;

  // ── COVENANT PACKAGE (Phase 90 Part B) ───────────────────────────────────
  covenant_package: import("@/lib/covenants/covenantTypes").CovenantPackage | null;

  // ── QUALITATIVE ASSESSMENT (Phase 90 Part C) ─────────────────────────────
  qualitative_assessment: import("./buildQualitativeAssessment").QualitativeAssessment | null;

  // ── COMMITTEE READINESS (SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 PR-B)
  // Projection of the SAME committee-readiness model the Committee Readiness panel
  // renders — the memo no longer states a separate, weaker truth. Null when no
  // committee model is on file (research not run / no mission).
  committee_readiness:
    | import("@/lib/creditMemo/committee/buildMemoCommitteeReadinessSection").MemoCommitteeReadinessSection
    | null;

  // ── META ─────────────────────────────────────────────────────────────────
  meta: {
    notes: string[];
    readiness: {
      status: "pending" | "partial" | "ready" | "error";
      last_generated_at: string | null;
      missing_spreads: string[];
      missing_metrics: string[];
    };
    // Narrow deal-type flags used ONLY to scope conditional completeness
    // warnings in sectionBuilders.ts (e.g. income_statement is CRE-exempt,
    // collateral analysis is required for CRE). Not a general product-type
    // classification — see buildCanonicalCreditMemo.ts's condIsCre/isLOC.
    deal_classification: {
      is_cre_deal: boolean;
      is_loc_deal: boolean;
      // True only on positive evidence of an owner at/above the SBA
      // personal-guaranty threshold who is identifiable as an individual
      // (see isLikelyIndividualOwner). Fails closed to false on
      // empty/ambiguous ownership data — never a hard blocker source.
      has_individual_guarantor_at_threshold: boolean;
      // SBA SOP 50 10 8 new-business status (< 24 months), from the same
      // detectNewBusinessFromFacts/assessNewBusinessRisk pair
      // feasibilityEngine.ts and sbaRiskProfile.ts use. Fails closed to
      // false when no business-age facts are on file.
      is_new_business: boolean;
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
