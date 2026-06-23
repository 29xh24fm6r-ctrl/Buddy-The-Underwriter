import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerOperationalContinuityPanel } from "@/components/banker/borrower-continuity/BorrowerOperationalContinuityPanel";
import { BankerIntakeBriefCard } from "@/components/banker/borrower-continuity/BankerIntakeBriefCard";
import { BankerNextBestActionCard } from "@/components/banker/borrower-continuity/BankerNextBestActionCard";
import { BorrowerMomentumSignalsCard } from "@/components/banker/borrower-continuity/BorrowerMomentumSignalsCard";
import { BankerContinuityCardsGrid } from "@/components/banker/borrower-continuity/BankerContinuityCardsGrid";
import { BankerOperationalTimelineSummary } from "@/components/banker/borrower-continuity/BankerOperationalTimelineSummary";
import {
  buildBorrowerOperationalContinuityViewModel,
  type BorrowerOperationalContinuityInput,
  type OperationalContinuityActivityEvent,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import {
  buildBorrowerReadinessViewModel,
  type ReadinessInput,
} from "@/lib/borrower/buildBorrowerReadinessViewModel";
import {
  buildBorrowerDealHealthViewModel,
  type DealHealthInput,
} from "@/lib/borrower/buildBorrowerDealHealthViewModel";
import {
  buildBorrowerGuidanceViewModel,
  type GuidanceInput,
} from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import {
  buildBorrowerCommunicationViewModel,
  type CommunicationInput,
} from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import {
  buildBorrowerDocumentExperienceViewModel,
  type BorrowerDocumentItemInput,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import { buildBorrowerMobileCommandViewModel } from "@/lib/borrower/buildBorrowerMobileCommandViewModel";
import { buildBorrowerSubmissionReadinessViewModel } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";
import { buildBorrowerTrustReviewViewModel } from "@/lib/borrower/buildBorrowerTrustReviewViewModel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Factory helpers (same shape used in VM tests)
// ---------------------------------------------------------------------------

type PortalStage = JourneyInput["portalStage"];

function mkJourney(over: Partial<JourneyInput> = {}) {
  return buildBorrowerJourneyViewModel({
    dealName: "Acme Holdings",
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    portalStage: "additional_items_needed",
    token: "t",
    ...over,
  });
}
function mkReadiness(over: Partial<ReadinessInput> = {}) {
  return buildBorrowerReadinessViewModel({
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    docsVerified: 3,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    sbaFormsReceived: 0,
    sbaFormsRequired: 0,
    blockerCount: 2,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    activity: [],
    portalStage: "additional_items_needed",
    token: "t",
    ...over,
  });
}
function mkDealHealth(over: Partial<DealHealthInput> = {}) {
  return buildBorrowerDealHealthViewModel({
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsVerified: 3,
    docsInFlight: false,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    sbaFormsReceived: 0,
    sbaFormsRequired: 0,
    blockerCount: 2,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    financialDocTypes: [],
    financialPeriods: [],
    extractedFinancialFields: [],
    portalStage: "additional_items_needed",
    token: "t",
    ...over,
  });
}
function mkGuidance(over: Partial<GuidanceInput> = {}) {
  return buildBorrowerGuidanceViewModel({
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
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    hasActivity: true,
    recommendationCount: 0,
    portalStage: "additional_items_needed",
    token: "t",
    ...over,
  });
}
function mkComm(over: Partial<CommunicationInput> = {}) {
  return buildBorrowerCommunicationViewModel({
    borrowerName: "Jane",
    token: "t",
    portalStage: "additional_items_needed",
    activity: [],
    blockers: [],
    documents: [],
    recommendations: [],
    ...over,
  });
}
function mkDocs(items: BorrowerDocumentItemInput[]) {
  return buildBorrowerDocumentExperienceViewModel({ token: "t", items });
}

function mkVM(opts: {
  portalStage?: PortalStage;
  docs?: BorrowerDocumentItemInput[];
  activity?: OperationalContinuityActivityEvent[];
  bankerWorkspaceHref?: string;
  requestDocumentsHref?: string;
} = {}) {
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    { id: "d2", title: "Balance Sheet", required: true, status: "received" },
  ];
  const portalStage = opts.portalStage ?? "additional_items_needed";
  const documents = mkDocs(docs);
  const journey = mkJourney({ portalStage });
  const readiness = mkReadiness({ portalStage });
  const dealHealth = mkDealHealth({ portalStage });
  const guidance = mkGuidance({ portalStage });
  const communication = mkComm({
    portalStage,
    documents: docs.map((d) => ({
      id: d.id,
      label: d.title,
      status: d.status,
      required: d.required,
    })),
  });
  const submission = buildBorrowerSubmissionReadinessViewModel({
    token: "t",
    journey,
    guidance,
    communication,
    documents,
  });
  const mobileCommand = buildBorrowerMobileCommandViewModel({
    borrowerName: "Jane",
    token: "t",
    journey,
    readiness,
    guidance,
    communication,
    documents,
  });
  const trustReview = buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: "Jane",
    journey,
    readiness,
    guidance,
    communication,
    documents,
    mobileCommand,
    submission,
  });
  const input: BorrowerOperationalContinuityInput = {
    dealId: "deal-123",
    borrowerName: "Jane",
    businessName: "Acme Holdings",
    journey,
    readiness,
    dealHealth,
    guidance,
    documents,
    communication,
    mobileCommand,
    submission,
    trustReview,
  };
  if (opts.activity) input.activity = opts.activity;
  if (opts.bankerWorkspaceHref) input.bankerWorkspaceHref = opts.bankerWorkspaceHref;
  if (opts.requestDocumentsHref) input.requestDocumentsHref = opts.requestDocumentsHref;
  return buildBorrowerOperationalContinuityViewModel(input);
}

// ---------------------------------------------------------------------------
// 1. Full continuity panel
// ---------------------------------------------------------------------------

test("BorrowerOperationalContinuityPanel renders all sub-sections", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerOperationalContinuityPanel, { viewModel: vm }),
  );
  assert.ok(html.includes("Borrower intake brief"));
  assert.ok(html.includes("Next best action"));
  assert.ok(html.includes("Momentum signals"));
  assert.ok(html.includes("Continuity overview"));
  assert.ok(html.includes("Recent activity"));
});

// ---------------------------------------------------------------------------
// 2. Minimal fallback panel
// ---------------------------------------------------------------------------

test("BorrowerOperationalContinuityPanel renders minimal fallback safely", () => {
  const vm = mkVM({ docs: [], portalStage: "getting_started" });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerOperationalContinuityPanel, { viewModel: vm }),
  );
  assert.ok(html.includes("Borrower starting"));
  assert.ok(html.includes("No recent borrower activity recorded"));
});

// ---------------------------------------------------------------------------
// 3. Intake brief rendering
// ---------------------------------------------------------------------------

test("BankerIntakeBriefCard renders headline, summary, state badge", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerIntakeBriefCard, { viewModel: vm }),
  );
  assert.ok(html.includes("Borrower intake brief"));
  assert.ok(html.includes(vm.headline));
  assert.ok(html.includes("Waiting on borrower"));
});

// ---------------------------------------------------------------------------
// 4. Next best action card with CTA
// ---------------------------------------------------------------------------

test("BankerNextBestActionCard renders CTA when href present", () => {
  const vm = mkVM({
    requestDocumentsHref: "/banker/deals/deal-123/request",
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerNextBestActionCard, { action: vm.nextBestAction }),
  );
  assert.ok(html.includes('href="/banker/deals/deal-123/request"'));
  assert.ok(html.includes("min-h-11"));
});

// ---------------------------------------------------------------------------
// 5. Next best action card without CTA
// ---------------------------------------------------------------------------

test("BankerNextBestActionCard hides CTA when href missing", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerNextBestActionCard, { action: vm.nextBestAction }),
  );
  // No href configured → no anchor rendered.
  assert.equal(html.includes('href="/banker'), false);
});

// ---------------------------------------------------------------------------
// 6. Momentum signals card
// ---------------------------------------------------------------------------

test("BorrowerMomentumSignalsCard renders counts and labels", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMomentumSignalsCard, { momentum: vm.momentum }),
  );
  assert.ok(html.includes("Momentum signals"));
  assert.ok(html.includes("Required received"));
  assert.ok(html.includes("Required remaining"));
  assert.ok(html.includes(vm.momentum.submissionReadinessLabel));
  assert.ok(html.includes(vm.momentum.trustReviewLabel));
});

// ---------------------------------------------------------------------------
// 7. Continuity cards grid
// ---------------------------------------------------------------------------

test("BankerContinuityCardsGrid renders all 6 cards", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerContinuityCardsGrid, { cards: vm.cards }),
  );
  assert.ok(html.includes("Continuity overview"));
  assert.ok(html.includes("Package readiness"));
  assert.ok(html.includes("Borrower action needed"));
  assert.ok(html.includes("Banker action needed"));
  assert.ok(html.includes("Documents &amp; attention"));
  assert.ok(html.includes("Submission preparation"));
  assert.ok(html.includes("Trust review"));
});

test("BankerContinuityCardsGrid renders nothing for empty list", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerContinuityCardsGrid, { cards: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 8. Timeline summary
// ---------------------------------------------------------------------------

test("BankerOperationalTimelineSummary renders real events newest first", () => {
  const vm = mkVM({
    activity: [
      {
        id: "a1",
        label: "Borrower uploaded Tax Return",
        timestamp: "2026-05-10T00:00:00.000Z",
        category: "upload",
      },
      {
        id: "a2",
        label: "Buddy reviewed Balance Sheet",
        timestamp: "2026-05-15T00:00:00.000Z",
        category: "review",
      },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerOperationalTimelineSummary, {
      events: vm.recentEvents,
    }),
  );
  const reviewIdx = html.indexOf("Buddy reviewed Balance Sheet");
  const uploadIdx = html.indexOf("Borrower uploaded Tax Return");
  assert.ok(reviewIdx !== -1);
  assert.ok(uploadIdx !== -1);
  assert.ok(reviewIdx < uploadIdx);
});

test("BankerOperationalTimelineSummary renders empty-state copy", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerOperationalTimelineSummary, { events: [] }),
  );
  assert.ok(html.includes("No recent borrower activity recorded"));
});

// ---------------------------------------------------------------------------
// 9. Accessible section labels
// ---------------------------------------------------------------------------

test("intake brief uses region role with aria-label", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerIntakeBriefCard, { viewModel: vm }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Borrower intake brief"'));
});

test("next best action uses region role and aria-label", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerNextBestActionCard, { action: vm.nextBestAction }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Banker next best action"'));
});

test("momentum signals uses region role and aria-label", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerMomentumSignalsCard, { momentum: vm.momentum }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Borrower momentum signals"'));
});

test("continuity cards grid has list role and aria-label", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerContinuityCardsGrid, { cards: vm.cards }),
  );
  assert.ok(html.includes('role="list"'));
  assert.ok(html.includes('aria-label="Continuity cards"'));
});

// ---------------------------------------------------------------------------
// 10. No internal enum leakage
// ---------------------------------------------------------------------------

test("rendered continuity panel does not leak internal enums or tech terms", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerOperationalContinuityPanel, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const term of [
    "docs_in_progress",
    "underwriting_queue",
    "lifecycle",
    "credit_memo",
    "classifier",
    "supabase",
    "extraction failed",
    "parser error",
  ]) {
    assert.ok(!lower.includes(term), `Internal term "${term}" leaked`);
  }
});

test("no FORBIDDEN_BORROWER_TERMS leak into banker continuity panel", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerOperationalContinuityPanel, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const term of FORBIDDEN_BORROWER_TERMS) {
    assert.ok(
      !lower.includes(term.toLowerCase()),
      `Forbidden borrower term "${term}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// 11. No approval / funding guarantee language
// ---------------------------------------------------------------------------

test("rendered continuity panel contains no approval/funding guarantee phrases", () => {
  const vm = mkVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerOperationalContinuityPanel, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const term of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "borrower qualifies",
    "loan will fund",
    "pre-approved",
    "conditional approval",
    "risk score",
    "credit decision",
  ]) {
    assert.ok(!lower.includes(term), `Forbidden phrase "${term}"`);
  }
});

// ---------------------------------------------------------------------------
// 12. No fake banker note rendering
// ---------------------------------------------------------------------------

test("rendered panel never claims a banker note was made", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerOperationalContinuityPanel, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  assert.ok(!lower.includes("banker noted"));
  assert.ok(!lower.includes("note added by banker"));
  assert.ok(!lower.includes("internal banker note"));
});

// ---------------------------------------------------------------------------
// 13. No fake timestamps in empty timeline
// ---------------------------------------------------------------------------

test("empty timeline does not synthesize a timestamp", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerOperationalTimelineSummary, { events: [] }),
  );
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(html), false);
});

// ---------------------------------------------------------------------------
// 14. Tables and mobile-safe structure
// ---------------------------------------------------------------------------

test("continuity panel does not use tables", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerOperationalContinuityPanel, { viewModel: vm }),
  );
  assert.ok(!html.includes("<table"));
});
