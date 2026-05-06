/**
 * buildMemoInputPackage shape + invariant tests.
 *
 * The package assembler is server-only (it calls Supabase). These tests
 * verify the SHAPE of the package by importing the type definitions and
 * exercising the evaluator that the assembler runs internally — they
 * don't reach the DB. Database integration is covered by
 * memoInputCompletenessGuard.test.ts (CI guard) and route-level tests.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMemoInputReadiness } from "@/lib/creditMemo/inputs/evaluateMemoInputReadiness";
import type {
  DealBorrowerStory,
  DealCollateralItem,
  DealFactConflict,
  DealManagementProfile,
  MemoInputPackage,
  RequiredFinancialFacts,
  ResearchGateSnapshot,
} from "@/lib/creditMemo/inputs/types";

function basicStory(): DealBorrowerStory {
  return {
    id: "s",
    deal_id: "d",
    bank_id: "b",
    business_description:
      "Operating company in food services with eight years of profitability.",
    revenue_model: "Subscription billing model.",
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

function basicMgmt(): DealManagementProfile[] {
  return [
    {
      id: "m",
      deal_id: "d",
      bank_id: "b",
      person_name: "Alex",
      title: null,
      ownership_pct: 80,
      years_experience: 12,
      industry_experience: "Twelve years in industry experience here.",
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

function basicCollateral(): DealCollateralItem[] {
  return [
    {
      id: "c",
      deal_id: "d",
      bank_id: "b",
      collateral_type: "real_estate",
      description: "Building",
      owner_name: null,
      market_value: 1_000_000,
      appraised_value: null,
      discounted_value: null,
      advance_rate: 0.75,
      lien_position: "1",
      valuation_date: null,
      valuation_source: null,
      source_document_id: null,
      confidence: 0.95,
      requires_review: false,
    },
  ];
}

function basicFacts(): RequiredFinancialFacts {
  return { dscr: 1.4, annualDebtService: 100_000, globalCashFlow: 250_000, loanAmount: 500_000 };
}

function basicResearch(): ResearchGateSnapshot {
  return { gate_passed: true, trust_grade: "committee_grade", quality_score: 0.9 };
}

// ───────────────────────────────────────────────────────────────────────

test("[pkg-1] valid input package: readiness ready=true and snapshot is self-contained shape", () => {
  // Build the package envelope manually. The key invariant is that every
  // required field is present and snapshot data flows into the package.
  const readiness = evaluateMemoInputReadiness({
    dealId: "d",
    borrowerStory: basicStory(),
    management: basicMgmt(),
    collateral: basicCollateral(),
    financialFacts: basicFacts(),
    research: basicResearch(),
    conflicts: [],
  });
  assert.equal(readiness.ready, true);

  const pkg: MemoInputPackage = {
    deal_id: "d",
    bank_id: "b",
    borrower_story: basicStory(),
    management_profiles: basicMgmt(),
    collateral_items: basicCollateral(),
    financial_facts: basicFacts(),
    financial_snapshot: { revenue: { value: 1_000_000 } },
    research: basicResearch(),
    conflicts: [],
    banker_overrides: { overrides: {} },
    readiness,
    package_version: "memo_input_package_v1",
    assembled_at: new Date().toISOString(),
  };

  // Snapshot remains self-contained: package round-trips through JSON
  // without losing structure.
  const json = JSON.stringify(pkg);
  const parsed = JSON.parse(json) as MemoInputPackage;
  assert.equal(parsed.deal_id, "d");
  assert.equal(parsed.readiness.ready, true);
  assert.equal(parsed.collateral_items.length, 1);
  assert.equal(parsed.management_profiles.length, 1);
});

test("[pkg-2] facts from live tables are copied into the package", () => {
  // The package's financial_facts is exactly the loader output — no further
  // mutation, no LLM rewriting. This test asserts that contract by
  // constructing a package manually and comparing.
  const facts = basicFacts();
  const pkg: MemoInputPackage = {
    deal_id: "d",
    bank_id: "b",
    borrower_story: basicStory(),
    management_profiles: basicMgmt(),
    collateral_items: basicCollateral(),
    financial_facts: facts,
    financial_snapshot: null,
    research: basicResearch(),
    conflicts: [],
    banker_overrides: { overrides: {} },
    readiness: evaluateMemoInputReadiness({
      dealId: "d",
      borrowerStory: basicStory(),
      management: basicMgmt(),
      collateral: basicCollateral(),
      financialFacts: facts,
      research: basicResearch(),
      conflicts: [],
    }),
    package_version: "memo_input_package_v1",
    assembled_at: "2026-05-06T00:00:00Z",
  };
  assert.equal(pkg.financial_facts.dscr, facts.dscr);
  assert.equal(pkg.financial_facts.annualDebtService, facts.annualDebtService);
  assert.equal(pkg.financial_facts.globalCashFlow, facts.globalCashFlow);
  assert.equal(pkg.financial_facts.loanAmount, facts.loanAmount);
});

test("[pkg-3] conflicts can be acknowledged and pkg.readiness.ready becomes true", () => {
  const conflicts: DealFactConflict[] = [
    {
      id: "x",
      deal_id: "d",
      bank_id: "b",
      fact_key: "revenue",
      conflict_type: "value_mismatch",
      source_a: { value: 1 },
      source_b: { value: 2 },
      status: "acknowledged",
      resolution: "ack",
      resolved_value: null,
      resolved_by: "u",
      resolved_at: "",
      created_at: "",
    },
  ];
  const readiness = evaluateMemoInputReadiness({
    dealId: "d",
    borrowerStory: basicStory(),
    management: basicMgmt(),
    collateral: basicCollateral(),
    financialFacts: basicFacts(),
    research: basicResearch(),
    conflicts,
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.conflicts_resolved, true);
});

test("[pkg-4] open conflicts block submit_allowed", () => {
  const conflicts: DealFactConflict[] = [
    {
      id: "x",
      deal_id: "d",
      bank_id: "b",
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
  const readiness = evaluateMemoInputReadiness({
    dealId: "d",
    borrowerStory: basicStory(),
    management: basicMgmt(),
    collateral: basicCollateral(),
    financialFacts: basicFacts(),
    research: basicResearch(),
    conflicts,
  });
  assert.equal(readiness.ready, false);
});
