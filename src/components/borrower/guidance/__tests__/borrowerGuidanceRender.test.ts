import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerGuidancePanel } from "@/components/borrower/guidance/BorrowerGuidancePanel";
import { BorrowerCoachedItemsCard } from "@/components/borrower/guidance/BorrowerCoachedItemsCard";
import { BorrowerWhatHappensNextCard } from "@/components/borrower/guidance/BorrowerWhatHappensNextCard";
import { BorrowerReassuranceCard } from "@/components/borrower/guidance/BorrowerReassuranceCard";
import { BorrowerFundingJourney } from "@/components/borrower/BorrowerFundingJourney";
import {
  buildBorrowerGuidanceViewModel,
  type GuidanceInput,
} from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guidanceInput(overrides: Partial<GuidanceInput> = {}): GuidanceInput {
  return {
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsVerified: 3,
    docsInFlight: false,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    blockerCount: 2,
    readinessScore: 45,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
      { id: "m2", title: "Voided Business Check", required: true },
    ],
    completedItems: [{ id: "c1", title: "Personal Financial Statement" }],
    hasActivity: true,
    recommendationCount: 2,
    portalStage: "additional_items_needed",
    token: "test-token",
    ...overrides,
  };
}

function journeyInput(): JourneyInput {
  return {
    dealName: "Acme SBA",
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
// 1. Guidance panel full state
// ---------------------------------------------------------------------------

test("BorrowerGuidancePanel renders full state", () => {
  const vm = buildBorrowerGuidanceViewModel(guidanceInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerGuidancePanel, { viewModel: vm }),
  );
  assert.ok(html.includes("Guidance from Buddy"));
  assert.ok(html.includes("Next recommended step"));
  assert.ok(html.includes("Items That Will Help Most"));
  assert.ok(html.includes("What Happens Next"));
  assert.ok(html.includes("Package Status"));
});

// ---------------------------------------------------------------------------
// 2. Guidance panel minimal state
// ---------------------------------------------------------------------------

test("BorrowerGuidancePanel renders minimal state", () => {
  const vm = buildBorrowerGuidanceViewModel(
    guidanceInput({
      missingItems: [],
      checklistMissing: 0,
      blockerCount: 0,
      portalStage: "ready_for_sba_review",
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerGuidancePanel, { viewModel: vm }),
  );
  assert.ok(html.includes("Guidance from Buddy"));
  // No coached items when none missing
  assert.ok(!html.includes("Items That Will Help Most"));
});

// ---------------------------------------------------------------------------
// 3. Coached item explanations
// ---------------------------------------------------------------------------

test("BorrowerCoachedItemsCard renders explanations", () => {
  const vm = buildBorrowerGuidanceViewModel(guidanceInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerCoachedItemsCard, { items: vm.coachedItems }),
  );
  assert.ok(html.includes("Items That Will Help Most"));
  // Should have coaching copy for tax returns
  assert.ok(html.includes("tax return") || html.includes("Tax"));
  // Should have "Why this matters" button
  assert.ok(html.includes("Why this matters"));
  // Should have upload CTA
  assert.ok(html.includes("Upload"));
});

// ---------------------------------------------------------------------------
// 4. What-happens-next rendering
// ---------------------------------------------------------------------------

test("BorrowerWhatHappensNextCard renders steps", () => {
  const vm = buildBorrowerGuidanceViewModel(guidanceInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerWhatHappensNextCard, { steps: vm.whatHappensNext }),
  );
  assert.ok(html.includes("What Happens Next"));
  assert.ok(html.includes("<ol"));
});

// ---------------------------------------------------------------------------
// 5. Reassurance card positive/neutral/attention states
// ---------------------------------------------------------------------------

test("BorrowerReassuranceCard renders positive tone", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReassuranceCard, {
      reassurance: { tone: "positive", message: "No blockers right now." },
    }),
  );
  assert.ok(html.includes("Package Status"));
  assert.ok(html.includes("No blockers right now."));
});

test("BorrowerReassuranceCard renders attention tone", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReassuranceCard, {
      reassurance: { tone: "attention", message: "Some items need action." },
    }),
  );
  assert.ok(html.includes("Some items need action."));
});

test("BorrowerReassuranceCard renders neutral tone", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReassuranceCard, {
      reassurance: { tone: "neutral", message: "Buddy is reviewing." },
    }),
  );
  assert.ok(html.includes("Buddy is reviewing."));
});

// ---------------------------------------------------------------------------
// 6. CTA rendering only when available
// ---------------------------------------------------------------------------

test("CTA button appears when nextStep has href", () => {
  const vm = buildBorrowerGuidanceViewModel(guidanceInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerGuidancePanel, { viewModel: vm }),
  );
  assert.ok(html.includes("/upload/test-token"));
  assert.ok(html.includes("Upload"));
});

test("no CTA button when wait_for_review focus", () => {
  const vm = buildBorrowerGuidanceViewModel(
    guidanceInput({
      missingItems: [],
      checklistMissing: 0,
      blockerCount: 0,
      recommendationCount: 0,
      ownershipVerified: true,
      portalStage: "ready_for_sba_review",
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerGuidancePanel, { viewModel: vm }),
  );
  assert.ok(!html.includes("/upload/"));
});

// ---------------------------------------------------------------------------
// 7. No approval guarantee language
// ---------------------------------------------------------------------------

test("rendered guidance HTML contains no approval/guarantee language", () => {
  const EXTRA_FORBIDDEN = [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "you qualify",
    "you are approved",
    "your loan will",
    "risk score",
    "internal review queue",
  ];

  const vm = buildBorrowerGuidanceViewModel(guidanceInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerGuidancePanel, { viewModel: vm }),
  );
  const lower = html.toLowerCase();

  for (const term of EXTRA_FORBIDDEN) {
    assert.ok(
      !lower.includes(term.toLowerCase()),
      `Forbidden term "${term}" in rendered HTML`,
    );
  }
});

// ---------------------------------------------------------------------------
// 8. No internal status leakage
// ---------------------------------------------------------------------------

test("rendered guidance HTML contains no forbidden borrower terms", () => {
  const stages: GuidanceInput["portalStage"][] = [
    "getting_started",
    "buddy_reviewing",
    "additional_items_needed",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const vm = buildBorrowerGuidanceViewModel(guidanceInput({ portalStage: stage }));
    const html = renderToStaticMarkup(
      React.createElement(BorrowerGuidancePanel, { viewModel: vm }),
    );
    const lower = html.toLowerCase();

    for (const term of FORBIDDEN_BORROWER_TERMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden term "${term}" in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 9. Backward compat — BorrowerFundingJourney without guidance
// ---------------------------------------------------------------------------

test("BorrowerFundingJourney renders without guidanceViewModel", () => {
  const jvm = buildBorrowerJourneyViewModel(journeyInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFundingJourney, { viewModel: jvm, dealName: "Test" }),
  );
  assert.ok(html.includes("Milestones toward lender submission"));
  assert.ok(!html.includes("Guidance from Buddy"));
});

test("BorrowerFundingJourney renders with guidanceViewModel", () => {
  const jvm = buildBorrowerJourneyViewModel(journeyInput());
  const gvm = buildBorrowerGuidanceViewModel(guidanceInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFundingJourney, {
      viewModel: jvm,
      guidanceViewModel: gvm,
      dealName: "Test",
    }),
  );
  assert.ok(html.includes("Guidance from Buddy"));
  assert.ok(html.includes("Milestones toward lender submission"));
});

// ---------------------------------------------------------------------------
// 10. Coaching map produces real explanations
// ---------------------------------------------------------------------------

test("coached tax return has whyItMatters and uploadHint", () => {
  const vm = buildBorrowerGuidanceViewModel(guidanceInput());
  const taxItem = vm.coachedItems.find((i) =>
    i.label.toLowerCase().includes("tax"),
  );
  assert.ok(taxItem);
  assert.ok(taxItem.whyItMatters?.includes("primary evidence"));
  assert.ok(taxItem.helpfulUploadHint?.includes("all pages"));
});
