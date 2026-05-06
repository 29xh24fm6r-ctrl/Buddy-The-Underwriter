/**
 * Memo Input Readiness Evaluator Tests
 *
 * Invariants:
 *   1. No borrower story (or stub-length description) → blocker
 *   2. No management profile → blocker
 *   3. No collateral item → blocker
 *   4. Open conflict → blocker
 *   5. Failed research gate → blocker
 *   6. Missing DSCR / debt service / global cash flow → individual blockers
 *   7. Acknowledged conflicts do NOT block
 *   8. All inputs satisfied → ready=true, score=100
 *   9. Score is bounded [0, 100]
 */

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMemoInputReadiness } from "@/lib/creditMemo/inputs/evaluateMemoInputReadiness";
import type {
  DealBorrowerStory,
  DealManagementProfile,
  DealCollateralItem,
  DealFactConflict,
  ResearchGateSnapshot,
  RequiredFinancialFacts,
} from "@/lib/creditMemo/inputs/types";

const DEAL_ID = "deal-test";
const NOW = new Date("2026-05-06T12:00:00Z");

function passingStory(overrides: Partial<DealBorrowerStory> = {}): DealBorrowerStory {
  return {
    id: "s1",
    deal_id: DEAL_ID,
    bank_id: "bank-test",
    business_description:
      "Operating company in food services with eight years of profitability.",
    revenue_model: "Subscription model with recurring monthly billing.",
    products_services: null,
    customers: null,
    customer_concentration: null,
    competitive_position: null,
    growth_strategy: null,
    seasonality: null,
    key_risks: null,
    banker_notes: null,
    source: "banker",
    confidence: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function passingManagement(): DealManagementProfile[] {
  return [
    {
      id: "m1",
      deal_id: DEAL_ID,
      bank_id: "bank-test",
      person_name: "Alex Owner",
      title: "CEO",
      ownership_pct: 75,
      years_experience: 15,
      industry_experience: "Restaurants and food services for 15 years.",
      prior_business_experience: null,
      resume_summary: null,
      credit_relevance: null,
      source: "banker",
      confidence: null,
      created_at: "",
      updated_at: "",
    },
  ];
}

function passingCollateral(): DealCollateralItem[] {
  return [
    {
      id: "c1",
      deal_id: DEAL_ID,
      bank_id: "bank-test",
      collateral_type: "real_estate",
      description: "Headquarters building",
      owner_name: "Borrower LLC",
      market_value: 1_500_000,
      appraised_value: 1_650_000,
      discounted_value: null,
      advance_rate: 0.75,
      lien_position: "1",
      valuation_date: null,
      valuation_source: "APPRAISAL",
      source_document_id: null,
      confidence: 0.95,
      requires_review: false,
    },
  ];
}

function passingFacts(): RequiredFinancialFacts {
  return {
    dscr: 1.4,
    annualDebtService: 200_000,
    globalCashFlow: 350_000,
    loanAmount: 1_000_000,
  };
}

function passingResearch(): ResearchGateSnapshot {
  return {
    gate_passed: true,
    trust_grade: "committee_grade",
    quality_score: 0.9,
  };
}

function args(over: Partial<Parameters<typeof evaluateMemoInputReadiness>[0]> = {}) {
  return {
    dealId: DEAL_ID,
    borrowerStory: passingStory(),
    management: passingManagement(),
    collateral: passingCollateral(),
    financialFacts: passingFacts(),
    research: passingResearch(),
    conflicts: [] as DealFactConflict[],
    now: NOW,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

test("[input-1] all inputs satisfied → ready=true, score=100", () => {
  const r = evaluateMemoInputReadiness(args());
  assert.equal(r.ready, true);
  assert.equal(r.blockers.length, 0);
  assert.equal(r.readiness_score, 100);
  assert.equal(r.borrower_story_complete, true);
  assert.equal(r.management_complete, true);
  assert.equal(r.collateral_complete, true);
  assert.equal(r.financials_complete, true);
  assert.equal(r.research_complete, true);
  assert.equal(r.conflicts_resolved, true);
});

test("[input-2] no borrower story → missing_business_description + missing_revenue_model blockers", () => {
  const r = evaluateMemoInputReadiness(args({ borrowerStory: null }));
  assert.equal(r.ready, false);
  const codes = r.blockers.map((b) => b.code);
  assert.ok(codes.includes("missing_business_description"));
  assert.ok(codes.includes("missing_revenue_model"));
  assert.equal(r.borrower_story_complete, false);
});

test("[input-3] empty management list → missing_management_profile blocker", () => {
  const r = evaluateMemoInputReadiness(args({ management: [] }));
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => b.code === "missing_management_profile"));
  assert.equal(r.management_complete, false);
});

test("[input-4] no collateral → missing_collateral_item blocker", () => {
  const r = evaluateMemoInputReadiness(args({ collateral: [] }));
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => b.code === "missing_collateral_item"));
  assert.equal(r.collateral_complete, false);
});

test("[input-5] collateral but zero values → missing_collateral_value blocker", () => {
  const c = passingCollateral();
  c[0].market_value = null;
  c[0].appraised_value = null;
  c[0].discounted_value = null;
  const r = evaluateMemoInputReadiness(args({ collateral: c }));
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => b.code === "missing_collateral_value"));
});

test("[input-6] missing DSCR → missing_dscr blocker", () => {
  const r = evaluateMemoInputReadiness(
    args({ financialFacts: { ...passingFacts(), dscr: null } }),
  );
  assert.ok(r.blockers.some((b) => b.code === "missing_dscr"));
});

test("[input-7] missing annual debt service → missing_debt_service_facts blocker", () => {
  const r = evaluateMemoInputReadiness(
    args({ financialFacts: { ...passingFacts(), annualDebtService: null } }),
  );
  assert.ok(r.blockers.some((b) => b.code === "missing_debt_service_facts"));
});

test("[input-8] missing global cash flow → missing_global_cash_flow blocker", () => {
  const r = evaluateMemoInputReadiness(
    args({ financialFacts: { ...passingFacts(), globalCashFlow: null } }),
  );
  assert.ok(r.blockers.some((b) => b.code === "missing_global_cash_flow"));
});

test("[input-9] failed research gate → missing_research_quality_gate blocker", () => {
  const r = evaluateMemoInputReadiness(args({ research: null }));
  assert.ok(r.blockers.some((b) => b.code === "missing_research_quality_gate"));

  const r2 = evaluateMemoInputReadiness(
    args({ research: { gate_passed: false, trust_grade: "research_failed", quality_score: 0.2 } }),
  );
  assert.ok(r2.blockers.some((b) => b.code === "missing_research_quality_gate"));
});

test("[input-10] open conflict → open_fact_conflicts blocker", () => {
  const conflicts: DealFactConflict[] = [
    {
      id: "x",
      deal_id: DEAL_ID,
      bank_id: "bank-test",
      fact_key: "revenue",
      conflict_type: "value_mismatch",
      source_a: { value: 1 },
      source_b: { value: 2 },
      status: "open",
      resolution: null,
      resolved_value: null,
      resolved_by: null,
      resolved_at: null,
      created_at: "",
    },
  ];
  const r = evaluateMemoInputReadiness(args({ conflicts }));
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => b.code === "open_fact_conflicts"));
  assert.equal(r.conflicts_resolved, false);
});

test("[input-11] acknowledged conflicts do NOT block submission", () => {
  const conflicts: DealFactConflict[] = [
    {
      id: "x",
      deal_id: DEAL_ID,
      bank_id: "bank-test",
      fact_key: "revenue",
      conflict_type: "value_mismatch",
      source_a: { value: 1 },
      source_b: { value: 2 },
      status: "acknowledged",
      resolution: "ack",
      resolved_value: null,
      resolved_by: "u1",
      resolved_at: "",
      created_at: "",
    },
  ];
  const r = evaluateMemoInputReadiness(args({ conflicts }));
  assert.equal(r.ready, true);
  assert.equal(r.conflicts_resolved, true);
});

test("[input-12] readiness score is bounded [0, 100]", () => {
  const r = evaluateMemoInputReadiness({
    dealId: DEAL_ID,
    borrowerStory: null,
    management: [],
    collateral: [],
    financialFacts: { dscr: null, annualDebtService: null, globalCashFlow: null, loanAmount: null },
    research: null,
    conflicts: [],
    unfinalizedDocCount: 5,
    policyExceptionsReviewed: false,
    now: NOW,
  });
  assert.ok(r.readiness_score >= 0);
  assert.ok(r.readiness_score <= 100);
});

test("[input-13] unfinalized required docs → unfinalized_required_documents blocker", () => {
  const r = evaluateMemoInputReadiness(args({ unfinalizedDocCount: 2 }));
  assert.ok(r.blockers.some((b) => b.code === "unfinalized_required_documents"));
});

test("[input-14] policy exceptions not reviewed → missing_policy_exception_review blocker", () => {
  const r = evaluateMemoInputReadiness(args({ policyExceptionsReviewed: false }));
  assert.ok(r.blockers.some((b) => b.code === "missing_policy_exception_review"));
});

test("[input-15] pure function: same inputs → identical output", () => {
  const a = evaluateMemoInputReadiness(args());
  const b = evaluateMemoInputReadiness(args());
  assert.deepEqual(a, b);
});
