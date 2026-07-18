// Phase 53A / 53A.1 — Deal Builder types
// All types for the builder data model, sections, and state.
// 53A.1 additions: collateral valuation, LTV, equity policy, owner prefill, readiness targets.

export type LoanType =
  | "term_loan"
  | "line_of_credit"
  | "sba_7a"
  | "sba_504"
  | "usda_b_and_i"
  | "cre_mortgage"
  | "ci_loan"
  | "equipment"
  | "construction"
  | "other";

export type EntityType =
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "sole_prop"
  | "trust"
  | "non_profit"
  | "other";

export type GuarantyType = "full" | "limited" | "springing" | "environmental";

export type CollateralType =
  | "real_estate"
  | "equipment"
  | "accounts_receivable"
  | "inventory"
  | "blanket_lien"
  | "vehicle"
  | "other";

export type ProceedsCategory =
  | "equipment"
  | "real_estate"
  | "working_capital"
  | "debt_payoff"
  | "acquisition"
  | "renovation"
  | "other";

export type CollateralValuationMethod =
  | "appraisal"
  | "management_stated_value"
  | "purchase_price"
  | "broker_opinion"
  | "book_value"
  | "tax_assessment"
  | "liquidation_estimate"
  | "other";

export type EquityRequirementSource =
  | "bank_policy"
  | "product_default"
  | "manual_override";

export type OwnerPrefillSource = {
  source_type: "business_tax_return" | "intake_identity" | "manual";
  source_document_id?: string | null;
  source_label?: string;
  confidence?: number;
};

export type BuilderStepKey =
  | "overview"
  | "parties"
  | "loan_request"
  | "financials"
  | "collateral"
  | "risk"
  | "documents"
  | "story"
  | "review";

export type BuilderSectionKey =
  | "deal"
  | "business"
  | "parties"
  | "guarantors"
  | "structure"
  | "story";

export type DealSectionData = {
  loan_purpose?: string;
  requested_amount?: number;
  loan_type?: LoanType;
  desired_term_months?: number;
  desired_amortization_months?: number;
  interest_only_months?: number;
  fixed_vs_floating?: "fixed" | "floating";
  target_close_date?: string;
  referral_source?: string;
  relationship_manager?: string;
  existing_bank_customer?: boolean;
  /** SBA Form 1244 — jobs impact, deal_loan_requests columns. */
  jobs_created_count?: number;
  jobs_retained_count?: number;
  /** SBA Form 601 (Agreement of Compliance) — construction contractor identity. */
  contractor_name?: string;
  contractor_address?: string;
  contractor_phone?: string;
  contractor_authorized_official?: string;
};

export type BusinessSectionData = {
  legal_entity_name?: string;
  dba?: string;
  ein?: string;
  entity_type?: EntityType;
  state_of_formation?: string;
  date_formed?: string;
  business_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  website?: string;
  naics_code?: string;
  industry_description?: string;
  operations_description?: string;
  employee_count?: number;
  seasonal?: boolean;
  key_customers?: string;
  /**
   * SBA 504 dual-entity structure — the Applicant business above can be an
   * Eligible Passive Company (EPC) that owns/leases the project to a
   * separate Operating Company. Gates whether the operating_company_*
   * fields below apply at all (see form1244/build.ts's
   * OC_REQUIRED_WHEN_EPC_KEYS). Only relevant to SBA 504 loans.
   */
  is_eligible_passive_company?: boolean;
  operating_company_legal_name?: string;
  operating_company_address?: string;
  operating_company_dba?: string;
  operating_company_legal_structure?: string;
  operating_company_tax_id?: string;
  operating_company_duns_number?: string;
  operating_company_contact_name?: string;
  operating_company_email?: string;
  operating_company_phone?: string;
  operating_company_website?: string;
  /** SBA Form 1244 Section One fields with no prior representation. */
  duns_number?: string;
  contact_name?: string;
  contact_email?: string;
  /** "Type of Business (Summary Description)" — sourced from borrowers.naics_description, distinct from the naics_code lookup field above. */
  type_of_business?: string;
  has_affiliates?: boolean;
  obtained_direct_or_guaranteed_loan?: boolean;
  prior_application_submitted?: boolean;
  prior_cdc_lender_name_and_program?: string;
  has_bankruptcy_history?: boolean;
  has_pending_lawsuits?: boolean;
};

export type CitizenshipStatus =
  | "us_citizen"
  | "us_national"
  | "lawful_permanent_resident"
  | "visa_holder"
  | "asylee"
  | "refugee"
  | "daca"
  | "other_ineligible"
  | "unknown";

export type BorrowerCard = {
  id: string;
  ownership_entity_id?: string;
  full_legal_name?: string;
  ssn_last4?: string;
  dob?: string;
  home_address?: string;
  home_city?: string;
  home_state?: string;
  home_zip?: string;
  ownership_pct?: number;
  title?: string;
  years_with_company?: number;
  /** @deprecated Use credit_pull_authorization_on_file instead */
  credit_auth_obtained?: boolean;
  credit_pull_authorization_on_file?: boolean;
  credit_pull_authorization_notes?: string;
  pfs_document_id?: string;
  prefill_source?: OwnerPrefillSource;
  prefill_status?: "suggested" | "accepted" | "edited";
  /**
   * Form 1244 Section Two ("Information Required to be Submitted by each
   * Associate of the Applicant") — real 5-question personal-history set
   * plus identity fields the form asks for beyond name/DOB/SSN/address.
   * Also feeds Form 912's 3-question overlap subset and 1919's broader
   * demographic block where the same columns apply.
   */
  former_names_and_dates_used?: string;
  citizenship_status?: CitizenshipStatus;
  country_of_citizenship?: string;
  home_phone?: string;
  sba_loan_entity_interest?: boolean;
  sba_loan_entity_interest_details?: string;
  subject_to_indictment?: boolean;
  arrested_or_charged_6mo?: boolean;
  convicted_diversion_or_parole?: boolean;
  suspended_debarred_ineligible?: boolean;
  /**
   * SBA Form 148L (Unconditional Limited Guarantee) — only relevant when
   * determineGuaranteeType(ownership_pct) returns "limited" (below the
   * 20% unconditional threshold, src/lib/ownership/rules.ts). 148/148L
   * pull signers directly from ownership_entities by ownership_pct, not
   * from a separate "guarantors" builder concept, so these fields belong
   * on the owner record. 7 mutually-exclusive limitation types, each with
   * at most one relevant amount/rate/description sub-field — see
   * GUARANTEE_LIMITATION_CHECKBOX in form148/pdfFieldMap.ts.
   */
  guarantee_limitation_type?:
    | "balance_reduction"
    | "principal_reduction"
    | "max_liability"
    | "percentage"
    | "time_based"
    | "collateral"
    | "community_property";
  guarantee_limit_balance_under?: number;
  guarantee_limit_principal_under?: number;
  guarantee_limit_max_payment?: number;
  guarantee_limit_percent_payment?: number;
  guarantee_limit_time_years?: number;
  guarantee_limit_collateral_description?: string;
};

export type PartiesSectionData = {
  owners: BorrowerCard[];
};

/**
 * Form 413's itemized supporting schedules (Sections 2-4) — one set per
 * 20%+ owner (applicant_id -> ownership_entities.id), backed by
 * borrower_pfs_notes_payable/securities/real_estate. Previously these
 * tables had no intake path at all (see form413/inputBuilder.ts, which
 * reads them, but nothing wrote them) — captured via a repeater UI in
 * EntityProfileDrawer, not the section-JSON/canonical-write pattern the
 * rest of the builder uses, since these are frequently-edited child rows
 * rather than a flat per-deal fact set.
 */
export type PfsNotePayable = {
  id: string;
  applicant_id: string;
  noteholder_name_address?: string | null;
  original_balance?: number | null;
  current_balance?: number | null;
  payment_amount?: number | null;
  payment_frequency?: string | null;
  collateral_description?: string | null;
  sort_order: number;
};

export type PfsSecurity = {
  id: string;
  applicant_id: string;
  number_of_shares?: number | null;
  name_of_securities?: string | null;
  cost?: number | null;
  market_value_quotation_exchange?: string | null;
  date_of_quotation?: string | null;
  total_value?: number | null;
  sort_order: number;
};

export type PfsRealEstateProperty = {
  id: string;
  applicant_id: string;
  property_label: "A" | "B" | "C";
  property_type?: string | null;
  address?: string | null;
  date_purchased?: string | null;
  original_cost?: number | null;
  present_market_value?: number | null;
  mortgage_holder_name_address?: string | null;
  mortgage_account_number?: string | null;
  mortgage_balance?: number | null;
  mortgage_payment_per_month_year?: string | null;
  mortgage_status?: string | null;
};

export type GuarantorCard = {
  id: string;
  same_as_borrower_id?: string;
  full_legal_name?: string;
  guaranty_type?: GuarantyType;
  guaranty_amount?: number;
  net_worth?: number;
  liquid_assets?: number;
  pfs_document_id?: string;
};

export type GuarantorsSectionData = {
  guarantors: GuarantorCard[];
  no_guarantors?: boolean;
};

export type StructureSectionData = {
  /** @deprecated Use equity_required_pct / equity_actual_pct instead */
  equity_injection_amount?: number;
  equity_injection_source?: string;
  equity_injection_type?:
    | "cash"
    | "equity_in_property"
    | "seller_note"
    | "other";
  // Phase 53A.1: policy-aware equity model
  equity_required_pct?: number;
  equity_actual_pct?: number;
  equity_required_amount?: number;
  equity_actual_amount?: number;
  equity_requirement_source?: EquityRequirementSource;
  equity_policy_reference?: string;
  equity_manually_overridden?: boolean;
  existing_debt_payoff?: boolean;
  existing_debt_description?: string;
  deposit_dda?: boolean;
  deposit_treasury?: boolean;
  deposit_payroll?: boolean;
  deposit_merchant?: boolean;
  participation_flag?: boolean;
  participation_details?: string;
};

export type StorySectionData = {
  loan_purpose_narrative?: string;
  management_qualifications?: string;
  competitive_position?: string;
  known_weaknesses?: string;
  deal_strengths?: string;
  committee_notes?: string;
  story_confirmations?: Record<string, "confirmed" | "edited">;
};

export type CollateralItem = {
  id: string;
  deal_id: string;
  item_type: CollateralType;
  description?: string;
  estimated_value?: number;
  lien_position: number;
  appraisal_date?: string;
  address?: string;
  // Phase 53A.1: valuation methodology + LTV
  valuation_method?: CollateralValuationMethod;
  valuation_source_note?: string;
  advance_rate?: number;
  net_lendable_value?: number;
  created_at: string;
  updated_at: string;
};

export type ProceedsItem = {
  id: string;
  deal_id: string;
  category: ProceedsCategory;
  description?: string;
  amount: number;
  created_at: string;
};

export type BuilderPrefill = {
  deal: Partial<DealSectionData>;
  business: Partial<BusinessSectionData>;
  owners: Partial<BorrowerCard>[];
  owner_candidates?: ExtractedOwnerCandidateSummary[];
  story: Partial<StorySectionData>;
  sources: Record<string, "buddy" | "manual">;
};

export type ExtractedOwnerCandidateSummary = {
  temp_id: string;
  full_legal_name?: string;
  ownership_pct?: number | null;
  title?: string | null;
  home_address?: string | null;
  home_city?: string | null;
  home_state?: string | null;
  home_zip?: string | null;
  source_document_id: string;
  source_label: string;
  confidence: number;
};

export type StepCompletion = {
  key: BuilderStepKey;
  label: string;
  pct: number;
  complete: boolean;
  warnings: number;
  blockers: number;
};

export type BuilderReadinessTarget = {
  step: BuilderStepKey;
  action?: "open_owner_drawer" | "open_guarantor_drawer" | "open_loan_request_drawer" | "open_collateral_modal" | "open_story_prompt_drawer";
  field_path?: string;
  entity_id?: string;
  collateral_id?: string;
  story_key?: string;
  focus_selector?: string;
};

export type BuilderReadinessBlocker = {
  key: string;
  label: string;
  severity: "blocker" | "warning";
  target: BuilderReadinessTarget;
};

export type BuilderPolicyException = {
  type: string;
  severity: "warning" | "exception";
  description: string;
  policy_reference?: string | null;
};

export type BuilderReadiness = {
  credit_ready: boolean;
  credit_ready_with_exceptions: boolean;
  credit_ready_pct: number;
  credit_ready_blockers: BuilderReadinessBlocker[];
  doc_ready: boolean;
  doc_ready_pct: number;
  doc_ready_blockers: BuilderReadinessBlocker[];
  policy_exceptions: BuilderPolicyException[];
};

export type ServerFlags = {
  snapshotExists: boolean;
  documentsReady: boolean;
  riskRunExists: boolean;
};

export type BuilderState = {
  sections: Partial<Record<BuilderSectionKey, Record<string, unknown>>>;
  collateral: CollateralItem[];
  proceeds: ProceedsItem[];
  prefill: BuilderPrefill | null;
  readiness: BuilderReadiness;
  activeStep: BuilderStepKey;
  saveState: "idle" | "saving" | "saved" | "error";
  lastSaved: string | null;
};
