import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionOrchestrationWorkspace } from "@/components/submission-orchestration/SubmissionOrchestrationWorkspace";
import { SubmissionOrchestrationHero } from "@/components/submission-orchestration/SubmissionOrchestrationHero";
import { SubmissionReadinessGates } from "@/components/submission-orchestration/SubmissionReadinessGates";
import { SubmissionPackageAssembly } from "@/components/submission-orchestration/SubmissionPackageAssembly";
import { SubmissionClarificationsPanel } from "@/components/submission-orchestration/SubmissionClarificationsPanel";
import { SubmissionOrchestrationNextActionCard } from "@/components/submission-orchestration/SubmissionOrchestrationNextActionCard";
import { SubmissionOrchestrationTimeline } from "@/components/submission-orchestration/SubmissionOrchestrationTimeline";
import {
  buildSubmissionOrchestrationViewModel,
  type SubmissionOrchestrationInput,
  type SubmissionOrchestrationActivityEvent,
  type PersistedBankerReviewState,
  type PersistedSubmissionState,
} from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import { buildBorrowerOperationalContinuityViewModel } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import { buildBorrowerReadinessViewModel } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import { buildBorrowerGuidanceViewModel } from "@/lib/borrower/buildBorrowerGuidanceViewModel";
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
import { buildBorrowerDealHealthViewModel } from "@/lib/borrower/buildBorrowerDealHealthViewModel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Factory helpers (mirror VM test factories)
// ---------------------------------------------------------------------------

type PortalStage = JourneyInput["portalStage"];

function buildStack(opts: {
  dealId?: string;
  docs?: BorrowerDocumentItemInput[];
  portalStage?: PortalStage;
  blockers?: CommunicationInput["blockers"];
} = {}) {
  const dealId = opts.dealId ?? "deal-1";
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    { id: "d2", title: "Balance Sheet", required: true, status: "received" },
  ];
  const portalStage = opts.portalStage ?? "additional_items_needed";
  const documents = buildBorrowerDocumentExperienceViewModel({ token: dealId, items: docs });
  const baseStage = {
    borrowerName: "Jane",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    sbaFormsReceived: 0,
    sbaFormsRequired: 0,
    blockerCount: 2,
    missingItems: [{ id: "m1", title: "Business Tax Returns", required: true }],
    completedItems: [{ id: "c1", title: "PFS" }],
    portalStage,
    token: dealId,
  };
  const journey = buildBorrowerJourneyViewModel({ dealName: "Acme", ...baseStage });
  const readiness = buildBorrowerReadinessViewModel({ ...baseStage, docsVerified: 3, activity: [] });
  const dealHealth = buildBorrowerDealHealthViewModel({
    ...baseStage,
    docsVerified: 3,
    financialDocTypes: [],
    financialPeriods: [],
    extractedFinancialFields: [],
  });
  const guidance = buildBorrowerGuidanceViewModel({
    ...baseStage,
    docsVerified: 3,
    readinessScore: 45,
    hasActivity: true,
    recommendationCount: 0,
  });
  const communication = buildBorrowerCommunicationViewModel({
    borrowerName: "Jane",
    token: dealId,
    portalStage,
    activity: [],
    blockers: opts.blockers ?? [],
    documents: docs.map((d) => ({
      id: d.id,
      label: d.title,
      status: d.status,
      required: d.required,
    })),
    recommendations: [],
  });
  const submission = buildBorrowerSubmissionReadinessViewModel({
    token: dealId,
    journey,
    guidance,
    communication,
    documents,
  });
  const mobileCommand = buildBorrowerMobileCommandViewModel({
    borrowerName: "Jane",
    token: dealId,
    journey,
    readiness,
    guidance,
    communication,
    documents,
  });
  const trustReview = buildBorrowerTrustReviewViewModel({
    token: dealId,
    borrowerName: "Jane",
    journey,
    readiness,
    guidance,
    communication,
    documents,
    mobileCommand,
    submission,
  });
  const continuity = buildBorrowerOperationalContinuityViewModel({
    dealId,
    borrowerName: "Jane",
    businessName: "Acme",
    journey,
    readiness,
    dealHealth,
    guidance,
    documents,
    communication,
    mobileCommand,
    submission,
    trustReview,
  });
  return { dealId, documents, communication, submission, trustReview, continuity };
}

function buildVM(opts: Parameters<typeof buildStack>[0] & {
  bankerReview?: PersistedBankerReviewState;
  submissionState?: PersistedSubmissionState;
  activity?: SubmissionOrchestrationActivityEvent[];
  prepareSubmissionHref?: string;
  reviewPackageHref?: string;
  resolveClarificationsHref?: string;
  requestDocumentsHref?: string;
} = {}) {
  const stack = buildStack(opts);
  const input: SubmissionOrchestrationInput = {
    dealId: stack.dealId,
    documents: stack.documents,
    communication: stack.communication,
    submission: stack.submission,
    trustReview: stack.trustReview,
    continuity: stack.continuity,
  };
  if (opts.bankerReview) input.bankerReview = opts.bankerReview;
  if (opts.submissionState) input.submissionState = opts.submissionState;
  if (opts.activity) input.activity = opts.activity;
  if (opts.prepareSubmissionHref) input.prepareSubmissionHref = opts.prepareSubmissionHref;
  if (opts.reviewPackageHref) input.reviewPackageHref = opts.reviewPackageHref;
  if (opts.resolveClarificationsHref) input.resolveClarificationsHref = opts.resolveClarificationsHref;
  if (opts.requestDocumentsHref) input.requestDocumentsHref = opts.requestDocumentsHref;
  return buildSubmissionOrchestrationViewModel(input);
}

// ---------------------------------------------------------------------------
// 1. Full workspace renders all sub-sections
// ---------------------------------------------------------------------------

test("SubmissionOrchestrationWorkspace renders hero, gates, package, clarifications, next action, timeline", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes("Submission orchestration"));
  assert.ok(html.includes("Readiness gates"));
  assert.ok(html.includes("Package assembly"));
  assert.ok(html.includes("Clarification tracking"));
  assert.ok(html.includes("Next orchestration action"));
  assert.ok(html.includes("Orchestration timeline"));
});

// ---------------------------------------------------------------------------
// 2. Minimal fallback
// ---------------------------------------------------------------------------

test("workspace renders minimal-state copy safely", () => {
  const vm = buildVM({ docs: [], portalStage: "getting_started" });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes("Not started"));
  assert.ok(html.includes("No orchestration events recorded yet"));
  // Required-documents gate must report "unavailable" copy when no list is published.
  assert.ok(html.includes("Document request list is not yet available"));
});

// ---------------------------------------------------------------------------
// 3. Hero renders state badge & headline
// ---------------------------------------------------------------------------

test("SubmissionOrchestrationHero renders state-specific badge label", () => {
  const vm = buildVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
    bankerReview: {
      packageInventoryReviewedAt: "2026-05-19T10:00:00.000Z",
      submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z",
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationHero, { viewModel: vm }),
  );
  assert.ok(html.includes("Ready for submission"));
});

// ---------------------------------------------------------------------------
// 4. Readiness gates render
// ---------------------------------------------------------------------------

test("SubmissionReadinessGates renders all gates and blocking label", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionReadinessGates, { gates: vm.gates }),
  );
  assert.ok(html.includes("All required documents received"));
  assert.ok(html.includes("Banker completed submission review"));
  assert.ok(html.includes("Blocking"));
});

test("SubmissionReadinessGates renders nothing for empty input", () => {
  const html = renderToStaticMarkup(
    React.createElement(SubmissionReadinessGates, { gates: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 5. Package assembly renders
// ---------------------------------------------------------------------------

test("SubmissionPackageAssembly renders section counts and items", () => {
  const vm = buildVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionPackageAssembly, { sections: vm.packageSections }),
  );
  assert.ok(html.includes("Financial package"));
  assert.ok(html.includes("SBA forms"));
  assert.ok(html.includes("Ownership &amp; identity"));
  assert.ok(html.includes("Business verification"));
  assert.ok(html.includes("Supporting documents"));
  assert.ok(html.includes("Clarification notes"));
  assert.ok(html.includes("Banker review notes"));
});

// ---------------------------------------------------------------------------
// 6. Clarifications panel renders
// ---------------------------------------------------------------------------

test("SubmissionClarificationsPanel renders items with priority and source labels", () => {
  const vm = buildVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "needs_attention" },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionClarificationsPanel, { items: vm.clarifications }),
  );
  assert.ok(html.includes("Clarification tracking"));
  assert.ok(html.includes("Required"));
  assert.ok(html.includes("Document"));
});

test("SubmissionClarificationsPanel renders empty-state when no clarifications", () => {
  const html = renderToStaticMarkup(
    React.createElement(SubmissionClarificationsPanel, { items: [] }),
  );
  assert.ok(html.includes("No outstanding clarifications"));
});

// ---------------------------------------------------------------------------
// 7. Next action card
// ---------------------------------------------------------------------------

test("SubmissionOrchestrationNextActionCard renders CTA when href present", () => {
  const vm = buildVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    bankerReview: {
      packageInventoryReviewedAt: "2026-05-19T10:00:00.000Z",
      submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z",
    },
    prepareSubmissionHref: "/banker/deals/deal-1/submit",
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationNextActionCard, {
      action: vm.nextAction,
    }),
  );
  assert.ok(html.includes("Prepare lender submission"));
  assert.ok(html.includes('href="/banker/deals/deal-1/submit"'));
  assert.ok(html.includes("min-h-11"));
});

test("SubmissionOrchestrationNextActionCard hides CTA when no href", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationNextActionCard, {
      action: vm.nextAction,
    }),
  );
  assert.equal(html.includes('href="/banker'), false);
});

// ---------------------------------------------------------------------------
// 8. Timeline rendering
// ---------------------------------------------------------------------------

test("SubmissionOrchestrationTimeline renders events newest first", () => {
  const vm = buildVM({
    activity: [
      { id: "a1", label: "Older event", timestamp: "2026-05-10T00:00:00.000Z", category: "borrower_action" },
      { id: "a2", label: "Newer event", timestamp: "2026-05-15T00:00:00.000Z", category: "banker_review" },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationTimeline, { events: vm.timeline }),
  );
  const newerIdx = html.indexOf("Newer event");
  const olderIdx = html.indexOf("Older event");
  assert.ok(newerIdx !== -1);
  assert.ok(olderIdx !== -1);
  assert.ok(newerIdx < olderIdx);
});

test("SubmissionOrchestrationTimeline renders empty-state when no events", () => {
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationTimeline, { events: [] }),
  );
  assert.ok(html.includes("No orchestration events recorded yet"));
});

// ---------------------------------------------------------------------------
// 9. Dark-theme classes
// ---------------------------------------------------------------------------

test("workspace renders dark-theme color tokens (text-white)", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes("text-white"));
  // Light-theme tokens like "bg-stone-50" must not appear — use a word-boundary
  // check that won't match the dark "bg-stone-500" utility.
  assert.equal(
    /\bbg-stone-50\b/.test(html),
    false,
    "must not leak light-theme bg-stone-50 background",
  );
});

// ---------------------------------------------------------------------------
// 10. Accessibility — region roles and aria-labels
// ---------------------------------------------------------------------------

test("workspace exposes region roles and aria-labels for major sections", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Submission orchestration workspace"'));
  assert.ok(html.includes('aria-label="Submission readiness gates"'));
  assert.ok(html.includes('aria-label="Submission package assembly"'));
  assert.ok(html.includes('aria-label="Submission clarifications"'));
  assert.ok(html.includes('aria-label="Submission orchestration next action"'));
  assert.ok(html.includes('aria-label="Submission orchestration timeline"'));
});

test("gates carry status aria-labels (non-color-only signal)", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionReadinessGates, { gates: vm.gates }),
  );
  assert.ok(html.includes("Status: Blocked"));
  assert.ok(html.includes("Status: Needs review"));
});

// ---------------------------------------------------------------------------
// 11. No internal enum leakage / no forbidden terms
// ---------------------------------------------------------------------------

test("workspace does not leak internal enums or tech terms", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
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
    "fake sla",
    "simulated",
  ]) {
    assert.ok(!lower.includes(term), `Internal term "${term}" leaked`);
  }
});

test("no FORBIDDEN_BORROWER_TERMS leak into the workspace", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
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
// 12. No approval / funding guarantee language
// ---------------------------------------------------------------------------

test("workspace renders no approval/funding guarantee phrases", () => {
  const vm = buildVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
    bankerReview: {
      packageInventoryReviewedAt: "2026-05-19T10:00:00.000Z",
      submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z",
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
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
// 13. No fake timestamps
// ---------------------------------------------------------------------------

test("workspace contains no ISO timestamps when input did not supply any", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
  );
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(html), false);
});

// ---------------------------------------------------------------------------
// 14. No tables
// ---------------------------------------------------------------------------

test("workspace renders no tables", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
  );
  assert.ok(!html.includes("<table"));
});

// ---------------------------------------------------------------------------
// 15. No fake submitted claim when not persisted
// ---------------------------------------------------------------------------

test("workspace does not say 'Submitted' or 'Submission complete' without persisted submittedAt", () => {
  const vm = buildVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
    bankerReview: {
      packageInventoryReviewedAt: "2026-05-19T10:00:00.000Z",
      submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z",
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(SubmissionOrchestrationWorkspace, { viewModel: vm }),
  );
  // "Ready for submission" is the operationally correct state — banker has not yet started a submission.
  assert.ok(html.includes("Ready for submission"));
  // The state label "Submission marked complete" must NOT appear without persistence.
  assert.equal(html.includes("Submission marked complete"), false);
});
