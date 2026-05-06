// Pure types for memo-input prefill suggestions.
//
// Suggestions are advisory — the banker must accept/edit/dismiss before
// values are persisted as banker-certified. Confidence < 0.85 means the
// banker should review carefully (Memo Inputs UI flags these).

export type SuggestionSource =
  | "document"
  | "research"
  | "deal"
  | "borrower"
  | "buddy"
  /** SPEC-13 — banker-entered text in the legacy deal_memo_overrides
   *  table, projected as a prefill suggestion. */
  | "banker_override_legacy";

export type SuggestedValue = {
  value: string;
  source: SuggestionSource;
  confidence: number;
  source_id?: string;
  reason: string;
};

export type SuggestedManagementProfile = {
  person_name: SuggestedValue;
  title?: SuggestedValue;
  ownership_pct?: SuggestedValue;
  years_experience?: SuggestedValue;
  industry_experience?: SuggestedValue;
  prior_business_experience?: SuggestedValue;
  resume_summary?: SuggestedValue;
  credit_relevance?: SuggestedValue;
};

export type SuggestedCollateralItem = {
  collateral_type: SuggestedValue;
  description: SuggestedValue;
  owner_name?: SuggestedValue;
  market_value?: SuggestedValue;
  appraised_value?: SuggestedValue;
  advance_rate?: SuggestedValue;
  lien_position?: SuggestedValue;
  valuation_date?: SuggestedValue;
  valuation_source?: SuggestedValue;
  source_document_id?: SuggestedValue;
};

export type MemoInputPrefill = {
  borrower_story: {
    business_description?: SuggestedValue;
    revenue_model?: SuggestedValue;
    products_services?: SuggestedValue;
    customers?: SuggestedValue;
    competitive_position?: SuggestedValue;
    key_risks?: SuggestedValue;
  };
  management_profiles: SuggestedManagementProfile[];
  collateral_items: SuggestedCollateralItem[];
};
