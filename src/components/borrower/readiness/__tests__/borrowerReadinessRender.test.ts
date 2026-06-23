import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerReadinessHero } from "@/components/borrower/readiness/BorrowerReadinessHero";
import { BorrowerReadinessRing } from "@/components/borrower/readiness/BorrowerReadinessRing";
import { BorrowerDealInsightsCard } from "@/components/borrower/readiness/BorrowerDealInsightsCard";
import { BorrowerRecommendationsCard } from "@/components/borrower/readiness/BorrowerRecommendationsCard";
import { BorrowerActivityFeed } from "@/components/borrower/readiness/BorrowerActivityFeed";
import { BorrowerDocumentCompletionChart } from "@/components/borrower/readiness/BorrowerDocumentCompletionChart";
import { BorrowerFundingJourney } from "@/components/borrower/BorrowerFundingJourney";
import {
  buildBorrowerReadinessViewModel,
  type ReadinessInput,
} from "@/lib/borrower/buildBorrowerReadinessViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import {
  FORBIDDEN_BORROWER_TERMS,
  FORBIDDEN_INTERNAL_ENUMS,
} from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readinessInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    docsVerified: 3,
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
    activity: [
      { id: "a1", title: "Buddy reviewed uploaded tax returns", detail: "Filed.", createdAt: "2026-05-18T10:00:00Z", kind: "review" },
    ],
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
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
    ],
    completedItems: [
      { id: "c1", title: "Personal Financial Statement" },
    ],
    portalStage: "additional_items_needed",
    token: "test-token",
  };
}

// ---------------------------------------------------------------------------
// 1. Readiness ring renders score
// ---------------------------------------------------------------------------

test("BorrowerReadinessRing renders score percentage", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReadinessRing, {
      score: 72,
      band: "strong_progress",
    }),
  );
  assert.ok(html.includes("72%"));
});

test("BorrowerReadinessRing supports all sizes", () => {
  for (const size of ["sm", "md", "lg"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(BorrowerReadinessRing, {
        score: 50,
        band: "progressing",
        size,
      }),
    );
    assert.ok(html.includes("50%"));
  }
});

// ---------------------------------------------------------------------------
// 2. Readiness hero renders band and summary
// ---------------------------------------------------------------------------

test("BorrowerReadinessHero renders band label and summary", () => {
  const vm = buildBorrowerReadinessViewModel(readinessInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReadinessHero, {
      readiness: vm.readiness,
      dealName: "Test Deal",
    }),
  );
  assert.ok(html.includes("Funding Readiness"));
  assert.ok(html.includes("Test Deal"));
  assert.ok(html.includes("Readiness"));
  assert.ok(html.includes(`${vm.readiness.score}%`));
});

test("BorrowerReadinessHero renders delta when present", () => {
  const vm = buildBorrowerReadinessViewModel(
    readinessInput({ previousScore: 30 }),
  );
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReadinessHero, {
      readiness: vm.readiness,
    }),
  );
  // delta should be shown
  assert.ok(html.includes("%"));
});

// ---------------------------------------------------------------------------
// 3. Deal insights card renders insights
// ---------------------------------------------------------------------------

test("BorrowerDealInsightsCard renders insight labels", () => {
  const vm = buildBorrowerReadinessViewModel(readinessInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDealInsightsCard, {
      insights: vm.insights,
    }),
  );
  assert.ok(html.includes("What Improved Your Deal"));
  // Should have at least one insight rendered
  assert.ok(vm.insights.length > 0);
  assert.ok(html.includes(vm.insights[0].label));
});

// ---------------------------------------------------------------------------
// 4. Recommendations card renders recommendations
// ---------------------------------------------------------------------------

test("BorrowerRecommendationsCard renders recommendation labels", () => {
  const vm = buildBorrowerReadinessViewModel(readinessInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerRecommendationsCard, {
      recommendations: vm.recommendations,
    }),
  );
  assert.ok(html.includes("Buddy Recommends"));
  assert.ok(html.includes("High impact") || html.includes("Helpful"));
});

test("BorrowerRecommendationsCard shows fallback when empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerRecommendationsCard, {
      recommendations: [
        {
          id: "rec_fallback",
          label: "Your package is progressing well",
          explanation: "Buddy will surface steps here.",
          priority: "low",
        },
      ],
    }),
  );
  assert.ok(html.includes("Buddy will surface"));
});

// ---------------------------------------------------------------------------
// 5. Activity feed renders events
// ---------------------------------------------------------------------------

test("BorrowerActivityFeed renders event labels", () => {
  const vm = buildBorrowerReadinessViewModel(readinessInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerActivityFeed, {
      events: vm.activity,
    }),
  );
  assert.ok(html.includes("Recent Activity"));
  assert.ok(html.includes("Buddy reviewed uploaded tax returns"));
});

test("BorrowerActivityFeed shows empty state", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerActivityFeed, { events: [] }),
  );
  assert.ok(html.includes("Buddy will show package activity"));
});

// ---------------------------------------------------------------------------
// 6. Document completion chart renders stats
// ---------------------------------------------------------------------------

test("BorrowerDocumentCompletionChart renders stats", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerDocumentCompletionChart, {
      received: 3,
      underReview: 1,
      remaining: 2,
      completionPercent: 50,
    }),
  );
  assert.ok(html.includes("Document Package"));
  assert.ok(html.includes("50% complete"));
  assert.ok(html.includes("Received"));
  assert.ok(html.includes("Under review"));
  assert.ok(html.includes("Remaining"));
});

// ---------------------------------------------------------------------------
// 7. Full BorrowerFundingJourney with readiness renders without crash
// ---------------------------------------------------------------------------

test("BorrowerFundingJourney renders with readiness intelligence layer", () => {
  const jvm = buildBorrowerJourneyViewModel(journeyInput());
  const rvm = buildBorrowerReadinessViewModel(readinessInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFundingJourney, {
      viewModel: jvm,
      readinessViewModel: rvm,
      dealName: "Acme SBA Loan",
    }),
  );
  assert.ok(html.length > 2000, "Expected substantial HTML");
  // Spec 1 components
  assert.ok(html.includes("Milestones toward lender submission"));
  assert.ok(html.includes("Completed"));
  assert.ok(html.includes("Still Needed"));
  // Spec 2 components
  assert.ok(html.includes("Funding Readiness"));
  assert.ok(html.includes("What Improved Your Deal"));
  assert.ok(html.includes("Buddy Recommends"));
  assert.ok(html.includes("Document Package"));
  assert.ok(html.includes("Recent Activity"));
});

// ---------------------------------------------------------------------------
// 8. BorrowerFundingJourney works without readiness (backward compat)
// ---------------------------------------------------------------------------

test("BorrowerFundingJourney renders without readinessViewModel (Spec 1 only)", () => {
  const jvm = buildBorrowerJourneyViewModel(journeyInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerFundingJourney, {
      viewModel: jvm,
      dealName: "Test Deal",
    }),
  );
  assert.ok(html.includes("Milestones toward lender submission"));
  assert.ok(!html.includes("Funding Readiness"));
});

// ---------------------------------------------------------------------------
// 9. No forbidden terms in rendered HTML
// ---------------------------------------------------------------------------

test("readiness layer HTML contains no forbidden borrower terms", () => {
  const stages: ReadinessInput["portalStage"][] = [
    "getting_started",
    "documents_requested",
    "buddy_reviewing",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const rvm = buildBorrowerReadinessViewModel(readinessInput({ portalStage: stage }));
    const jvm = buildBorrowerJourneyViewModel(journeyInput());
    const html = renderToStaticMarkup(
      React.createElement(BorrowerFundingJourney, {
        viewModel: jvm,
        readinessViewModel: rvm,
        dealName: "Test",
      }),
    );
    const lower = html.toLowerCase();

    for (const term of FORBIDDEN_BORROWER_TERMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden term "${term}" in rendered HTML for stage "${stage}"`,
      );
    }

    for (const term of FORBIDDEN_INTERNAL_ENUMS) {
      assert.ok(
        !lower.includes(term.toLowerCase()),
        `Forbidden internal enum "${term}" in rendered HTML for stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 10. Mobile-safe structure
// ---------------------------------------------------------------------------

test("readiness components produce valid HTML elements", () => {
  const rvm = buildBorrowerReadinessViewModel(readinessInput());
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReadinessHero, {
      readiness: rvm.readiness,
    }),
  );
  assert.ok(html.includes("<section"));
  assert.ok(html.includes("</section>"));
});
