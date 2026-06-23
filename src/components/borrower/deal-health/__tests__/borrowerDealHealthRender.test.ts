import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerDealHealthDashboard } from "@/components/borrower/deal-health/BorrowerDealHealthDashboard";
import { BorrowerDealHealthOverviewCards } from "@/components/borrower/deal-health/BorrowerDealHealthOverviewCards";
import { BorrowerDealHealthRadar } from "@/components/borrower/deal-health/BorrowerDealHealthRadar";
import { BorrowerUnderwriterPreviewCard } from "@/components/borrower/deal-health/BorrowerUnderwriterPreviewCard";
import { BorrowerFinancialSnapshot } from "@/components/borrower/deal-health/BorrowerFinancialSnapshot";
import { BorrowerAttentionItems } from "@/components/borrower/deal-health/BorrowerAttentionItems";
import { BorrowerFundingJourney } from "@/components/borrower/BorrowerFundingJourney";
import {
  buildBorrowerDealHealthViewModel,
  type DealHealthInput,
} from "@/lib/borrower/buildBorrowerDealHealthViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import {
  FORBIDDEN_BORROWER_TERMS,
} from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dealHealthInput(overrides: Partial<DealHealthInput> = {}): DealHealthInput {
  return {
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsVerified: 3,
    docsInFlight: false,
    profileCompleteness: 0.7,
    ownershipVerified: true,
    sbaFormsReceived: 1,
    sbaFormsRequired: 2,
    blockerCount: 2,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
      { id: "m2", title: "Voided Business Check", required: true },
    ],
    completedItems: [
      { id: "c1", title: "Personal Financial Statement" },
    ],
    financialDocTypes: ["Tax Return", "P&L"],
    financialPeriods: ["2023"],
    extractedFinancialFields: ["revenue"],
    portalStage: "additional_items_needed",
    token: "test-token",
    ...overrides,
  };
}

function journeyInput(): JourneyInput {
  return {
    dealName: "Acme SBA Loan",
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "Personal Financial Statement" }],
    portalStage: "additional_items_needed",
    token: "test-token",
  };
}

// ---------------------------------------------------------------------------
// 1. Dashboard renders with full data
// ---------------------------------------------------------------------------

test("BorrowerDealHealthDashboard renders with full data", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDealHealthDashboard, { viewModel: vm }),
  );
  assert.ok(html.length > 1000);
  assert.ok(html.includes("Deal Health Overview"));
  assert.ok(html.includes("Package Health"));
  assert.ok(html.includes("What a Reviewer Can See"));
  assert.ok(html.includes("Financial Snapshot"));
  assert.ok(html.includes("Attention Items"));
});

// ---------------------------------------------------------------------------
// 2. Dashboard renders with minimal data
// ---------------------------------------------------------------------------

test("BorrowerDealHealthDashboard renders with minimal data", () => {
  const vm = buildBorrowerDealHealthViewModel(
    dealHealthInput({
      checklistRequired: 0,
      checklistReceived: 0,
      checklistMissing: 0,
      docsUploaded: 0,
      docsVerified: 0,
      profileCompleteness: 0,
      ownershipVerified: false,
      sbaFormsRequired: 0,
      sbaFormsReceived: 0,
      blockerCount: 0,
      missingItems: [],
      completedItems: [],
      financialDocTypes: [],
      financialPeriods: [],
      extractedFinancialFields: [],
      portalStage: "getting_started",
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDealHealthDashboard, { viewModel: vm }),
  );
  assert.ok(html.includes("Deal Health Overview"));
  assert.ok(html.includes("Pending")); // unavailable categories show Pending
});

// ---------------------------------------------------------------------------
// 3. Radar/category visual renders safely
// ---------------------------------------------------------------------------

test("BorrowerDealHealthRadar renders all categories", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDealHealthRadar, { categories: vm.categories }),
  );
  assert.ok(html.includes("Submission Readiness by Category"));
  assert.ok(html.includes("Documentation Strength"));
  assert.ok(html.includes("Financial Package"));
});

test("BorrowerDealHealthOverviewCards renders status badges", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDealHealthOverviewCards, { categories: vm.categories }),
  );
  assert.ok(html.includes("Strong") || html.includes("Progressing") || html.includes("Needs Attention"));
});

// ---------------------------------------------------------------------------
// 4. Financial snapshot fallback when no financial data
// ---------------------------------------------------------------------------

test("BorrowerFinancialSnapshot shows fallback when unavailable", () => {
  const vm = buildBorrowerDealHealthViewModel(
    dealHealthInput({ financialDocTypes: [], financialPeriods: [], extractedFinancialFields: [] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFinancialSnapshot, { snapshot: vm.financialSnapshot }),
  );
  assert.ok(html.includes("after Buddy reviews"));
  assert.ok(!html.includes("Statements Received"));
});

test("BorrowerFinancialSnapshot shows real data when available", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFinancialSnapshot, { snapshot: vm.financialSnapshot }),
  );
  assert.ok(html.includes("Tax Return"));
  assert.ok(html.includes("2023"));
  assert.ok(html.includes("revenue"));
});

// ---------------------------------------------------------------------------
// 5. Underwriter preview renders strengths/needed/clarifications
// ---------------------------------------------------------------------------

test("BorrowerUnderwriterPreviewCard renders sections", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerUnderwriterPreviewCard, { items: vm.reviewerPreview }),
  );
  assert.ok(html.includes("What a Reviewer Can See So Far"));
  assert.ok(html.includes("Visible Strengths"));
  assert.ok(html.includes("Still Needed"));
});

// ---------------------------------------------------------------------------
// 6. Attention items render by priority
// ---------------------------------------------------------------------------

test("BorrowerAttentionItems renders grouped by priority", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerAttentionItems, { items: vm.attentionItems }),
  );
  assert.ok(html.includes("Required before submission"));
  assert.ok(html.includes("Business Tax Returns"));
});

test("BorrowerAttentionItems shows empty state when no items", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerAttentionItems, { items: [] }),
  );
  assert.ok(html.includes("No outstanding items"));
});

// ---------------------------------------------------------------------------
// 7. No approval/funding guarantee language
// ---------------------------------------------------------------------------

test("rendered HTML contains no approval/guarantee language", () => {
  const EXTRA_FORBIDDEN = [
    "approval odds",
    "guaranteed",
    "approved",
    "probability of approval",
    "credit score",
    "bank approval",
    "funding guarantee",
  ];

  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDealHealthDashboard, { viewModel: vm }),
  );
  const lower = html.toLowerCase();

  for (const term of EXTRA_FORBIDDEN) {
    assert.ok(
      !lower.includes(term.toLowerCase()),
      `Forbidden term "${term}" found in rendered HTML`,
    );
  }
});

// ---------------------------------------------------------------------------
// 8. No fake financial values
// ---------------------------------------------------------------------------

test("rendered financial snapshot contains no dollar amounts", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFinancialSnapshot, { snapshot: vm.financialSnapshot }),
  );
  assert.ok(!html.includes("$"), "Financial snapshot should not contain dollar signs");
});

// ---------------------------------------------------------------------------
// 9. Full forbidden term regression
// ---------------------------------------------------------------------------

test("deal health dashboard HTML contains no forbidden borrower terms", () => {
  const stages: DealHealthInput["portalStage"][] = [
    "getting_started",
    "buddy_reviewing",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const vm = buildBorrowerDealHealthViewModel(dealHealthInput({ portalStage: stage }));
    const html = renderToStaticMarkup(
      React.createElement(BorrowerDealHealthDashboard, { viewModel: vm }),
    );
    const lower = html.toLowerCase();

    for (const term of FORBIDDEN_BORROWER_TERMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden term "${term}" in stage "${stage}"`,
      );
    }

    // Spec 3 forbidden terms (no approval/guarantee language)
    for (const term of ["approval odds", "guaranteed funding", "probability of approval", "credit_memo", "underwriting_queue"]) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden term "${term}" in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 10. BorrowerFundingJourney backward compat — no dealHealthViewModel
// ---------------------------------------------------------------------------

test("BorrowerFundingJourney renders without dealHealthViewModel", () => {
  const jvm = buildBorrowerJourneyViewModel(journeyInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFundingJourney, {
      viewModel: jvm,
      dealName: "Test",
    }),
  );
  assert.ok(html.includes("Milestones toward lender submission"));
  assert.ok(!html.includes("Deal Health Overview"));
});

test("BorrowerFundingJourney renders with dealHealthViewModel", () => {
  const jvm = buildBorrowerJourneyViewModel(journeyInput());
  const dhvm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFundingJourney, {
      viewModel: jvm,
      dealHealthViewModel: dhvm,
      dealName: "Test",
    }),
  );
  assert.ok(html.includes("Deal Health Overview"));
  assert.ok(html.includes("Milestones toward lender submission"));
});

// ---------------------------------------------------------------------------
// 11. Trust copy present
// ---------------------------------------------------------------------------

test("trust copy appears in dashboard", () => {
  const vm = buildBorrowerDealHealthViewModel(dealHealthInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDealHealthDashboard, { viewModel: vm }),
  );
  assert.ok(
    html.includes("not loan approval") || html.includes("package completeness"),
    "Expected trust disclaimer copy in dashboard",
  );
});
