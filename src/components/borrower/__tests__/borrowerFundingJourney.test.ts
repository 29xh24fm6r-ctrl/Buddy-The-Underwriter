import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerFundingJourney } from "@/components/borrower/BorrowerFundingJourney";
import { BorrowerJourneyMilestones } from "@/components/borrower/BorrowerJourneyMilestones";
import { BorrowerProgressSummary } from "@/components/borrower/BorrowerProgressSummary";
import { BorrowerBlockersCard } from "@/components/borrower/BorrowerBlockersCard";
import { BorrowerJourneyActionCard } from "@/components/borrower/BorrowerJourneyActionCard";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
  type BorrowerJourneyViewModel,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import {
  FORBIDDEN_BORROWER_TERMS,
  FORBIDDEN_INTERNAL_ENUMS,
} from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    dealName: "Acme SBA Loan",
    borrowerName: "Jane",
    checklistRequired: 5,
    checklistReceived: 2,
    checklistMissing: 3,
    docsUploaded: 3,
    docsInFlight: false,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
      { id: "m2", title: "Voided Business Check", required: true },
      { id: "m3", title: "SBA Form 1919", required: true },
    ],
    completedItems: [
      { id: "c1", title: "Personal Financial Statement" },
      { id: "c2", title: "Business License" },
    ],
    portalStage: "additional_items_needed",
    token: "test-token",
    ...overrides,
  };
}

function renderJourney(overrides: Partial<JourneyInput> = {}) {
  const vm = buildBorrowerJourneyViewModel(baseInput(overrides));
  return renderToStaticMarkup(
    React.createElement(BorrowerFundingJourney, {
      viewModel: vm,
      dealName: overrides.dealName ?? "Acme SBA Loan",
    }),
  );
}

// ---------------------------------------------------------------------------
// 1. Milestone rendering
// ---------------------------------------------------------------------------

test("BorrowerJourneyMilestones renders all 8 milestones", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerJourneyMilestones, {
      milestones: vm.milestones,
    }),
  );
  assert.ok(html.includes("Started Application"));
  assert.ok(html.includes("Business Profile"));
  assert.ok(html.includes("Financial Documents"));
  assert.ok(html.includes("SBA Forms"));
  assert.ok(html.includes("Buddy Review"));
  assert.ok(html.includes("Banker Review"));
  assert.ok(html.includes("Ready for Lender Submission"));
});

// ---------------------------------------------------------------------------
// 2. Completed / current / upcoming / blocked status rendering
// ---------------------------------------------------------------------------

test("completed milestones show Completed tag", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerJourneyMilestones, {
      milestones: vm.milestones,
    }),
  );
  assert.ok(html.includes("Completed"));
});

test("blocked milestones show Needs attention tag", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerJourneyMilestones, {
      milestones: vm.milestones,
    }),
  );
  assert.ok(html.includes("Needs attention"));
});

test("current milestones show In progress tag", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({ portalStage: "buddy_reviewing", checklistMissing: 0, missingItems: [] }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerJourneyMilestones, {
      milestones: vm.milestones,
    }),
  );
  assert.ok(html.includes("In progress"));
});

// ---------------------------------------------------------------------------
// 3. Progress percentage rendering
// ---------------------------------------------------------------------------

test("journey header renders progress percentage", () => {
  const html = renderJourney();
  assert.ok(html.includes("%"));
  // Ensure a number before the %
  assert.ok(/\d+%/.test(html));
});

// ---------------------------------------------------------------------------
// 4. Empty / fallback state
// ---------------------------------------------------------------------------

test("remaining card shows fallback when no missing items", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({ missingItems: [], checklistMissing: 0 }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerProgressSummary, {
      completedItems: vm.completedItems,
      remainingItems: vm.remainingItems,
    }),
  );
  assert.ok(html.includes("Buddy"));
  assert.ok(html.includes("reviewing") || html.includes("surface"));
});

// ---------------------------------------------------------------------------
// 5. Blocker card appears only when blockers exist
// ---------------------------------------------------------------------------

test("blockers card renders blocker items when present", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerBlockersCard, { blockers: vm.blockers }),
  );
  assert.ok(html.includes("Needs Your Attention"));
  assert.ok(html.includes("Business Tax Returns"));
});

test("blockers card shows no-blockers message when empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerBlockersCard, { blockers: [] }),
  );
  assert.ok(html.includes("No major blockers"));
});

// ---------------------------------------------------------------------------
// 6. Next best action fallback behavior
// ---------------------------------------------------------------------------

test("action card renders upload CTA when critical items missing", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerJourneyActionCard, {
      action: vm.nextBestAction,
    }),
  );
  assert.ok(html.includes("Upload"));
  assert.ok(html.includes("Your next step"));
});

test("action card renders all-caught-up when no action", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerJourneyActionCard, { action: undefined }),
  );
  assert.ok(html.includes("No action needed"));
  assert.ok(html.includes("All caught up"));
});

// ---------------------------------------------------------------------------
// 7. Mobile-safe markup — milestone list renders as ol on mobile
// ---------------------------------------------------------------------------

test("milestone component has mobile vertical list (ol element)", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerJourneyMilestones, {
      milestones: vm.milestones,
    }),
  );
  assert.ok(html.includes("<ol"));
});

// ---------------------------------------------------------------------------
// 8. No raw internal lifecycle/status leakage in borrower-facing copy
// ---------------------------------------------------------------------------

test("rendered HTML contains no forbidden borrower terms", () => {
  const stages: JourneyInput["portalStage"][] = [
    "getting_started",
    "documents_requested",
    "documents_received",
    "buddy_reviewing",
    "additional_items_needed",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const html = renderJourney({ portalStage: stage });
    const lower = html.toLowerCase();

    for (const term of FORBIDDEN_BORROWER_TERMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden term "${term}" found in rendered HTML for stage "${stage}"`,
      );
    }

    for (const term of FORBIDDEN_INTERNAL_ENUMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden internal enum "${term}" found in rendered HTML for stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 9. Full orchestrator renders without error
// ---------------------------------------------------------------------------

test("BorrowerFundingJourney renders complete journey without crashing", () => {
  const html = renderJourney();
  assert.ok(html.length > 500, "Expected substantial HTML output");
  assert.ok(html.includes("Your SBA funding package"));
  assert.ok(html.includes("Milestones toward lender submission"));
  assert.ok(html.includes("Completed"));
  assert.ok(html.includes("Still Needed"));
});

// ---------------------------------------------------------------------------
// 10. Deal name appears in header when provided
// ---------------------------------------------------------------------------

test("deal name appears in journey header", () => {
  const html = renderJourney({ dealName: "Big Corp SBA Loan" });
  assert.ok(html.includes("Big Corp SBA Loan"));
});
