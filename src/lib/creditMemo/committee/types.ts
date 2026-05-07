// Pure types for the Committee Anticipation Engine.
//
// PURITY: no server-only imports. Consumed by the pure rules + orchestrator
// AND by CI guard tests.
//
// Mapping to the god-tier spec (Stage 6 + Stage 9):
//   • objections      → "Stage 6: Buddy predicts likely committee objections"
//   • follow_ups      → "Stage 6: probable follow-up questions"
//   • doc_weaknesses  → "Stage 9: documentation weaknesses"
//   • positioning     → "Stage 9: recommended positioning"
//   • posture         → "Stage 9: This deal is committee-ready / hard sell"

export type ObjectionDomain =
  | "repayment"
  | "leverage"
  | "liquidity"
  | "collateral"
  | "concentration"
  | "documentation"
  | "policy"
  | "structural"
  | "industry"
  | "guarantor";

// Severity controls posture grade and rendering. "hard" = MD-level concern;
// "soft" = expect a question; "info" = surface but rarely raised.
export type ObjectionSeverity = "hard" | "soft" | "info";

export type CommitteeObjection = {
  // Stable code — used by the CI guard to ensure every code has a fixPath.
  code: string;
  domain: ObjectionDomain;
  severity: ObjectionSeverity;
  // Banker-readable label that an MD would write on the deal.
  label: string;
  // One-sentence rationale citing the metric/source. NEVER a generic line.
  rationale: string;
  // Optional one-line mitigant that the banker can lean on in committee.
  mitigant?: string;
  // Where the banker fixes / addresses this. If null, this is informational.
  fixPath?: string;
  // Provenance citation. Helps the banker audit the engine's claim.
  source?: {
    metric?: string;
    value?: number | string | null;
    threshold?: number | string;
  };
};

export type CommitteePosture =
  | "committee_ready"           // 0 hard objections, ≥ baseline strengths
  | "workable_with_mitigants"   // 1-2 hard objections, defensible
  | "hard_sell"                 // 3+ hard objections; restructure recommended
  | "not_ready";                // memo not even submittable (input gaps)

export type PositioningRecommendation = {
  // 1-3 lead lines the banker should walk into committee with.
  lead_with: string[];
  // 1-3 explicit anticipated questions to prepare answers for.
  prepare_for: string[];
  // Optional one-line strategic frame ("emphasize recurring revenue stability").
  frame?: string;
};

export type CommitteeAnticipationReport = {
  deal_id: string;
  posture: CommitteePosture;
  // Aggregate score 0..100 — informally how confidently committee will pass.
  // NOT a credit score; a posture indicator only.
  confidence_score: number;
  objections: CommitteeObjection[];
  doc_weaknesses: CommitteeObjection[];
  follow_ups: string[];
  positioning: PositioningRecommendation;
  // Always emit a one-liner the banker can read aloud / quote.
  headline: string;
  evaluatedAt: string;
  contractVersion: "committee_anticipation_v1";
};

// ─── Engine input contract ───────────────────────────────────────────────────

// Deliberately a small surface so the pure engine doesn't depend on every
// snapshot shape detail. Server assembler maps DB rows → this shape.
export type CommitteeEngineInputs = {
  dealId: string;
  // Core financial metrics — null when not computed.
  metrics: {
    dscr: number | null;
    dscr_stressed_300bps: number | null;
    cash_flow_available: number | null;
    annual_debt_service: number | null;
    excess_cash_flow: number | null;
    global_cash_flow: number | null;
    gcf_dscr: number | null;
    revenue_ttm: number | null;
    ebitda_ttm: number | null;
    net_income_ttm: number | null;
    // Leverage / coverage
    debt_to_equity: number | null;
    total_liabilities: number | null;
    net_worth: number | null;
    // Collateral
    collateral_gross_value: number | null;
    collateral_discounted_value: number | null;
    collateral_coverage: number | null;
    ltv_gross: number | null;
    ltv_net: number | null;
    // Loan
    loan_amount: number | null;
    bank_loan_total: number | null;
    // Liquidity
    pfs_total_assets: number | null;
    pfs_net_worth: number | null;
  };
  // Memo input layer signals (from buildMemoInputPackage).
  memoInput: {
    ready: boolean;
    blockerCodes: string[];
    openConflictsCount: number;
    borrowerStoryCustomers: string | null;
    borrowerStoryConcentration: string | null;
    borrowerStoryRevenueModel: string | null;
    borrowerStoryRisks: string | null;
    managementProfilesCount: number;
    collateralItemsCount: number;
    collateralWithValueCount: number;
  };
  // Research signals.
  research: {
    gate_passed: boolean;
    trust_grade:
      | "committee_grade"
      | "preliminary"
      | "manual_review_required"
      | "research_failed"
      | null;
    quality_score: number | null;
    industry: string | null;
  } | null;
  // Pricing decision presence.
  pricing: {
    decided: boolean;
    rate_initial_pct: number | null;
  };
  // Policy exception count from existing infrastructure (best-effort).
  openPolicyExceptionsCount: number;
  // Covenant package presence.
  covenantPackagePresent: boolean;
  now?: Date;
};

// Each rule module exports a pure function with this signature.
export type CommitteeRule = (
  inputs: CommitteeEngineInputs,
) => CommitteeObjection[];
