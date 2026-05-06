/**
 * Collateral normalization invariants.
 *
 * These tests cover the pure pieces of collateral handling that the
 * evaluator depends on. The collateral upsert itself is exercised through
 * route + integration tests; here we focus on the invariants that gate
 * memo submission.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMemoInputReadiness } from "@/lib/creditMemo/inputs/evaluateMemoInputReadiness";
import type {
  DealBorrowerStory,
  DealCollateralItem,
  DealManagementProfile,
  RequiredFinancialFacts,
  ResearchGateSnapshot,
} from "@/lib/creditMemo/inputs/types";

function story(): DealBorrowerStory {
  return {
    id: "s",
    deal_id: "d",
    bank_id: "b",
    business_description: "x".repeat(40),
    revenue_model: "y".repeat(20),
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
  };
}
function mgmt(): DealManagementProfile[] {
  return [
    {
      id: "m",
      deal_id: "d",
      bank_id: "b",
      person_name: "P",
      title: null,
      ownership_pct: null,
      years_experience: 10,
      industry_experience: null,
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
function facts(): RequiredFinancialFacts {
  return { dscr: 1.3, annualDebtService: 100_000, globalCashFlow: 200_000, loanAmount: 500_000 };
}
function research(): ResearchGateSnapshot {
  return { gate_passed: true, trust_grade: "committee_grade", quality_score: 0.9 };
}

function collateralItem(over: Partial<DealCollateralItem> = {}): DealCollateralItem {
  return {
    id: "c",
    deal_id: "d",
    bank_id: "b",
    collateral_type: "real_estate",
    description: "Property",
    owner_name: null,
    market_value: null,
    appraised_value: null,
    discounted_value: null,
    advance_rate: null,
    lien_position: null,
    valuation_date: null,
    valuation_source: null,
    source_document_id: null,
    confidence: null,
    requires_review: false,
    ...over,
  };
}

function r(collateral: DealCollateralItem[]) {
  return evaluateMemoInputReadiness({
    dealId: "d",
    borrowerStory: story(),
    management: mgmt(),
    collateral,
    financialFacts: facts(),
    research: research(),
    conflicts: [],
  });
}

// ───────────────────────────────────────────────────────────────────────

test("[collateral-1] appraised_value alone satisfies collateral_complete", () => {
  const out = r([collateralItem({ appraised_value: 1_000_000 })]);
  assert.equal(out.collateral_complete, true);
  assert.equal(out.ready, true);
});

test("[collateral-2] market_value alone satisfies collateral_complete", () => {
  const out = r([collateralItem({ market_value: 800_000 })]);
  assert.equal(out.collateral_complete, true);
});

test("[collateral-3] discounted_value alone satisfies collateral_complete", () => {
  const out = r([collateralItem({ discounted_value: 400_000 })]);
  assert.equal(out.collateral_complete, true);
});

test("[collateral-4] zero values do not satisfy collateral_complete", () => {
  const out = r([collateralItem({ market_value: 0, appraised_value: 0 })]);
  assert.equal(out.collateral_complete, false);
  assert.ok(out.blockers.some((b) => b.code === "missing_collateral_value"));
});

test("[collateral-5] requires_review flag emits warning, never blocker", () => {
  const out = r([
    collateralItem({ market_value: 750_000, requires_review: true, confidence: 0.6 }),
  ]);
  assert.equal(out.ready, true);
  assert.ok(out.warnings.some((w) => w.code === "collateral_requires_review"));
  assert.ok(!out.blockers.some((b) => b.code === "missing_collateral_value"));
});

test("[collateral-6] negative valuations do not satisfy collateral_complete", () => {
  const out = r([collateralItem({ market_value: -1, appraised_value: -1 })]);
  assert.equal(out.collateral_complete, false);
});
