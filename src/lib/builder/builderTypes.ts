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
};

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
};

export type PartiesSectionData = {
  owners: BorrowerCard[];
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

export type BuilderReadiness = {
  credit_ready: boolean;
  credit_ready_pct: number;
  credit_ready_blockers: BuilderReadinessBlocker[];
  doc_ready: boolean;
  doc_ready_pct: number;
  doc_ready_blockers: BuilderReadinessBlocker[];
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
