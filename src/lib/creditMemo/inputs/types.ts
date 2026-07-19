// Memo Input Completeness Layer — pure types.
//
// No imports of server-only modules. This file is safe to import from CI
// guard tests and pure evaluators alike. (canonicalGcfCore is pure — no
// "server-only" — so importing its types here is allowed.)

import type { GcfPrerequisite } from "@/lib/financialFacts/canonicalGcfCore";

export type MemoInputBlockerCode =
  | "missing_business_description"
  | "missing_revenue_model"
  | "missing_management_profile"
  | "missing_collateral_item"
  | "missing_collateral_value"
  | "missing_research_quality_gate"
  | "open_fact_conflicts"
  | "unfinalized_required_documents"
  // SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: business cash flow is the earliest
  // upstream financial prerequisite — it must be presentable as its own step,
  // ahead of the downstream GCF / DSCR blockers.
  | "missing_business_cash_flow"
  | "missing_dscr"
  | "missing_global_cash_flow"
  | "missing_policy_exception_review"
  | "missing_debt_service_facts"
  | "missing_ar_borrowing_base";

export type MemoInputWarningCode =
  | "low_research_quality"
  | "collateral_requires_review"
  | "borrower_story_incomplete"
  | "management_profile_thin"
  | "dscr_proxy_source";

export type BlockerOwner = "banker" | "borrower" | "buddy";

export type MemoInputBlocker = {
  code: MemoInputBlockerCode;
  label: string;
  owner: BlockerOwner;
  fixPath: string;
};

export type MemoInputWarning = {
  code: MemoInputWarningCode;
  label: string;
  fixPath?: string;
};

export type MemoInputReadiness = {
  ready: boolean;
  borrower_story_complete: boolean;
  management_complete: boolean;
  collateral_complete: boolean;
  financials_complete: boolean;
  research_complete: boolean;
  conflicts_resolved: boolean;
  readiness_score: number; // 0..100
  blockers: MemoInputBlocker[];
  warnings: MemoInputWarning[];
  evaluatedAt: string;
  contractVersion: "memo_input_v1";
};

// ── Story / Management / Collateral row shapes ───────────────────────────────

export type DealBorrowerStory = {
  id: string;
  deal_id: string;
  bank_id: string;
  business_description: string | null;
  revenue_model: string | null;
  products_services: string | null;
  customers: string | null;
  customer_concentration: string | null;
  competitive_position: string | null;
  growth_strategy: string | null;
  seasonality: string | null;
  key_risks: string | null;
  banker_notes: string | null;
  // SPEC-MEMO-INPUTS-INDUSTRY-CLASSIFICATION-FIELD-1: industry / NAICS context,
  // editable from the memo-input Borrower Story and read by buildResearchSubject.
  // Optional: added as nullable columns, so rows persisted before the migration
  // (and existing fixtures) need not carry them.
  industry_classification?: string | null;
  naics_code?: string | null;
  naics_description?: string | null;
  // SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1: provenance from Buddy's NAICS
  // suggestion tool — "suggested" | "manual" and the model's 0.0–1.0 confidence.
  naics_source?: string | null;
  naics_confidence?: number | null;
  // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: deal-level entity
  // identity for borrower_id=null deals. Gives research a real legal/DBA/website
  // search name + a banker-certified identity summary for the private-company path.
  legal_name?: string | null;
  dba?: string | null;
  website?: string | null;
  hq_city?: string | null;
  hq_state?: string | null;
  banker_identity_summary?: string | null;
  // Feeds ELIGIBILITY.CREDIT_ELSEWHERE_50108 (SOP 50 10 8 §A Ch.5 HARD_STOP
  // rule) via buildSbaEligibilityInput — see src/lib/sba/dealDataBuilder.ts.
  credit_elsewhere_documented?: boolean | null;
  credit_elsewhere_finding?: "unavailable" | "available_but_unfavorable_terms" | "available" | null;
  credit_elsewhere_narrative?: string | null;
  source: "banker" | "borrower" | "buddy" | "research";
  confidence: number | null;
  created_at: string;
  updated_at: string;
};

export type DealManagementProfile = {
  id: string;
  deal_id: string;
  bank_id: string;
  person_name: string;
  title: string | null;
  ownership_pct: number | null;
  years_experience: number | null;
  industry_experience: string | null;
  prior_business_experience: string | null;
  resume_summary: string | null;
  credit_relevance: string | null;
  source:
    | "banker"
    | "borrower"
    | "buddy"
    | "resume"
    | "sba_form"
    | "pfs";
  confidence: number | null;
  created_at: string;
  updated_at: string;
};

export type DealCollateralItem = {
  id: string;
  deal_id: string;
  bank_id: string | null;
  collateral_type: string | null;
  description: string | null;
  owner_name: string | null;
  market_value: number | null;
  appraised_value: number | null;
  discounted_value: number | null;
  advance_rate: number | null;
  lien_position: string | null;
  valuation_date: string | null;
  valuation_source: string | null;
  source_document_id: string | null;
  confidence: number | null;
  requires_review: boolean;
};

export type FactConflictStatus = "open" | "acknowledged" | "resolved" | "ignored";

export type DealFactConflict = {
  id: string;
  deal_id: string;
  bank_id: string;
  fact_key: string;
  conflict_type: string;
  source_a: Record<string, unknown> | null;
  source_b: Record<string, unknown> | null;
  status: FactConflictStatus;
  resolution: string | null;
  resolved_value: unknown;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

// ── Required financial fact set used by the evaluator ────────────────────────

export type RequiredFinancialFacts = {
  dscr: number | null;
  annualDebtService: number | null;
  globalCashFlow: number | null;
  loanAmount: number | null;
  // SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: business cash flow (CASH_FLOW_AVAILABLE)
  // is the earliest upstream prerequisite GCF aggregates. Gated as its own step.
  cashFlowAvailable: number | null;
};

// ── Research gate snapshot ───────────────────────────────────────────────────

export type ResearchGateSnapshot = {
  gate_passed: boolean;
  trust_grade:
    | "committee_grade"
    | "preliminary"
    | "manual_review_required"
    | "research_failed"
    | null;
  quality_score: number | null;
};

// ── Evaluator inputs (what evaluateMemoInputReadiness needs) ─────────────────

export type EvaluateMemoInputReadinessArgs = {
  dealId: string;
  borrowerStory: DealBorrowerStory | null;
  management: DealManagementProfile[];
  collateral: DealCollateralItem[];
  financialFacts: RequiredFinancialFacts;
  research: ResearchGateSnapshot | null;
  conflicts: DealFactConflict[];
  unfinalizedDocCount?: number;
  policyExceptionsReviewed?: boolean;
  now?: Date;
  /** When true, AR borrowing base facts are required for readiness. */
  isArLocDeal?: boolean;
  /** Whether AR borrowing base facts exist. */
  hasArBorrowingBase?: boolean;
  /** ACTIVATION: When true, snapshot collateral value exists (memo can render collateral even without explicit items). */
  hasSnapshotCollateral?: boolean;
  /** ACTIVATION: DSCR source — "authoritative" (snapshot/spread), "proxy" (T12/structural), or null. */
  dscrSource?: "authoritative" | "proxy" | null;
  /**
   * SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: dependency-ordered GCF prerequisites
   * (from the canonical selector). When provided, missing_dscr / missing_global_cash_flow
   * route to the earliest unresolved upstream step instead of a GCF dead-end.
   */
  gcfPrerequisites?: {
    ready: boolean;
    earliestMissing: GcfPrerequisite | null;
  };
};

// ── Memo Input Package — assembled before snapshot freeze ────────────────────

export type DealMemoOverridesSnapshot = {
  overrides: Record<string, unknown>;
};

export type MemoInputPackage = {
  deal_id: string;
  bank_id: string;
  borrower_story: DealBorrowerStory | null;
  management_profiles: DealManagementProfile[];
  collateral_items: DealCollateralItem[];
  financial_facts: RequiredFinancialFacts;
  // Snapshot is opaque to the input layer — type as unknown so this types file
  // stays free of dependencies on FloridaArmory shapes.
  financial_snapshot: unknown;
  research: ResearchGateSnapshot | null;
  conflicts: DealFactConflict[];
  banker_overrides: DealMemoOverridesSnapshot;
  readiness: MemoInputReadiness;
  package_version: "memo_input_package_v1";
  assembled_at: string;
};
