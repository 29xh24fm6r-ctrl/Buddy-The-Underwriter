export type CanonicalMemoNumber = number | null;

export type CanonicalMetricSource = {
  source: string; // e.g. "Spreads:T12" | "Facts:COLLATERAL.AS_IS_VALUE" | "Pending"
  updated_at: string | null;
};

export type CanonicalMetricValue = CanonicalMetricSource & {
  value: CanonicalMemoNumber;
};

export type CanonicalCreditMemoV1 = {
  version: "canonical_v1";
  deal_id: string;
  bank_id: string;
  generated_at: string;

  header: {
    deal_name: string;
    borrower_name: string;
    prepared_by: string;
    date: string;
    request_summary: string;
  };

  key_metrics: {
    loan_amount: CanonicalMetricValue;
    product: string;
    rate_summary: string;
    dscr_uw: CanonicalMetricValue;
    dscr_stressed: CanonicalMetricValue;
    ltv_gross: CanonicalMetricValue;
    ltv_net: CanonicalMetricValue;
    debt_yield: CanonicalMetricValue;
    cap_rate: CanonicalMetricValue;
    stabilization_status: string;
  };

  executive_summary: {
    narrative: string;
  };

  transaction_overview: {
    loan_request: {
      purpose: string;
      term_months: CanonicalMemoNumber;
      amount: CanonicalMemoNumber;
      product: string;
    };
  };

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

  global_cash_flow: {
    global_cash_flow: CanonicalMetricValue;
    global_dscr: CanonicalMetricValue;
    cash_available: CanonicalMetricValue;
    personal_debt_service: CanonicalMetricValue;
    living_expenses: CanonicalMetricValue;
    total_obligations: CanonicalMetricValue;
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

  collateral: {
    property_description: string;
    property_address: string;
    gross_value: CanonicalMetricValue;
    net_value: CanonicalMetricValue;
    discounted_value: CanonicalMetricValue;
    discounted_coverage: CanonicalMetricValue;
    valuation: {
      as_is: CanonicalMetricValue;
      stabilized: CanonicalMetricValue;
    };
    collateral_coverage: CanonicalMetricValue;
    stabilization_status: string;
  };

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
    // Phase 3: Institutional computed metrics
    revenue?: CanonicalMetricValue;
    ebitda?: CanonicalMetricValue;
    net_income?: CanonicalMetricValue;
    working_capital?: CanonicalMetricValue;
    current_ratio?: CanonicalMetricValue;
    debt_to_equity?: CanonicalMetricValue;
  };

  sources_uses: {
    total_project_cost: CanonicalMetricValue;
    borrower_equity: CanonicalMetricValue;
    borrower_equity_pct: CanonicalMetricValue;
    bank_loan_total: CanonicalMetricValue;
    sources: Array<{ description: string; amount: CanonicalMetricValue }>;
    uses: Array<{ description: string; amount: CanonicalMetricValue }>;
  };

  risk_factors: Array<{
    risk: string;
    severity: "low" | "medium" | "high";
    mitigants: string[];
  }>;

  policy_exceptions: Array<{
    exception: string;
    rationale: string;
  }>;

  proposed_terms: {
    product: string;
    rate: {
      all_in_rate: CanonicalMemoNumber;
      index: string;
      margin_bps: CanonicalMemoNumber;
    };
    rationale: string;
  };

  conditions: {
    precedent: string[];
    ongoing: string[];
  };

  recommendation: {
    verdict: "approve" | "caution" | "decline_risk" | "pending";
    headline: string;
    risk_grade: string;
    risk_score: number | null;
    confidence: number | null;
    rationale: string[];
    key_drivers: string[];
    mitigants: string[];
  };

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
