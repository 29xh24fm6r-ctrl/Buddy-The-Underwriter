import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerSubmissionReadinessHero } from "@/components/borrower/submission/BorrowerSubmissionReadinessHero";
import { BorrowerSubmissionChecklist } from "@/components/borrower/submission/BorrowerSubmissionChecklist";
import { BorrowerSubmissionPackageSummary } from "@/components/borrower/submission/BorrowerSubmissionPackageSummary";
import { BorrowerSubmissionAttentionItems } from "@/components/borrower/submission/BorrowerSubmissionAttentionItems";
import { BorrowerSubmissionEducationCard } from "@/components/borrower/submission/BorrowerSubmissionEducationCard";
import {
  buildBorrowerSubmissionReadinessViewModel,
  type SubmissionReadinessInput,
} from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
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
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function mkJourney(over: Partial<JourneyInput> = {}) {
  return buildBorrowerJourneyViewModel({
    dealName: "Acme",
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

function mkInput(over: Partial<SubmissionReadinessInput> = {}): SubmissionReadinessInput {
  return {
    token: "t",
    journey: mkJourney(),
    guidance: mkGuidance(),
    communication: mkComm(),
    documents: mkDocs([
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "needs_attention" },
    ]),
    ...over,
  };
}

function makeVM(over: Partial<SubmissionReadinessInput> = {}) {
  return buildBorrowerSubmissionReadinessViewModel(mkInput(over));
}

// ---------------------------------------------------------------------------
// 1. Readiness hero renders
// ---------------------------------------------------------------------------

test("BorrowerSubmissionReadinessHero renders headline, band, progress", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm }),
  );
  assert.ok(html.includes("Submission readiness"));
  assert.ok(html.includes(vm.bandLabel));
  assert.ok(html.includes("%"));
});

test("BorrowerSubmissionReadinessHero renders submission_preparation_ready band", () => {
  const vm = makeVM({
    documents: mkDocs([
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ]),
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm }),
  );
  assert.ok(html.includes("Preparing for lender submission"));
  assert.ok(html.includes("100%"));
});

// ---------------------------------------------------------------------------
// 2. Checklist renders
// ---------------------------------------------------------------------------

test("BorrowerSubmissionChecklist renders items", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionChecklist, { items: vm.checklist }),
  );
  assert.ok(html.includes("Package readiness checklist"));
  assert.ok(html.includes("Attention items resolved"));
  assert.ok(html.includes("Guidance follow-ups addressed"));
});

test("BorrowerSubmissionChecklist renders nothing when empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionChecklist, { items: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 3. Package summary renders received items
// ---------------------------------------------------------------------------

test("BorrowerSubmissionPackageSummary renders received items grouped by category", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionPackageSummary, { items: vm.packageItems }),
  );
  if (vm.packageItems.length > 0) {
    assert.ok(html.includes("Included in your package"));
  }
});

test("BorrowerSubmissionPackageSummary renders nothing when empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionPackageSummary, { items: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 4. Attention items render
// ---------------------------------------------------------------------------

test("BorrowerSubmissionAttentionItems renders priority items with CTA", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionAttentionItems, { items: vm.attentionItems }),
  );
  if (vm.attentionItems.length > 0) {
    assert.ok(html.includes("Still needed before submission preparation"));
    assert.ok(html.includes("min-h-11"));
  }
});

test("BorrowerSubmissionAttentionItems renders nothing when empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionAttentionItems, { items: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 5. Education card renders steps
// ---------------------------------------------------------------------------

test("BorrowerSubmissionEducationCard renders numbered steps", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionEducationCard, { steps: vm.nextSteps }),
  );
  assert.ok(html.includes("What happens before lender submission"));
  assert.ok(html.includes("not a lending decision"));
  assert.ok(html.includes("<ol"));
});

// ---------------------------------------------------------------------------
// 6. Mobile-safe structure
// ---------------------------------------------------------------------------

test("submission components have no dense tables", () => {
  const vm = makeVM();
  const html =
    renderToStaticMarkup(React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionChecklist, { items: vm.checklist })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionEducationCard, { steps: vm.nextSteps }));
  assert.ok(!html.includes("<table"));
});

// ---------------------------------------------------------------------------
// 7. No internal enum leakage
// ---------------------------------------------------------------------------

test("rendered submission components do not leak internal enums", () => {
  const vm = makeVM();
  const html =
    renderToStaticMarkup(React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionChecklist, { items: vm.checklist })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionPackageSummary, { items: vm.packageItems })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionAttentionItems, { items: vm.attentionItems })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionEducationCard, { steps: vm.nextSteps }));
  const lower = html.toLowerCase();

  for (const term of [
    "docs_in_progress",
    "underwriting_queue",
    "lifecycle",
    "credit_memo",
    "classifier",
    "extraction failed",
    "parser error",
  ]) {
    assert.ok(!lower.includes(term), `Internal enum "${term}" leaked`);
  }
});

// ---------------------------------------------------------------------------
// 8. No approval/guarantee language
// ---------------------------------------------------------------------------

test("rendered submission components contain no approval/guarantee language", () => {
  const vm = makeVM({
    documents: mkDocs([
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ]),
  });
  const html =
    renderToStaticMarkup(React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionEducationCard, { steps: vm.nextSteps }));
  const lower = html.toLowerCase();

  for (const term of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "you qualify",
    "you are approved",
    "your loan will",
    "pre-approved",
    "conditional approval",
    "risk score",
    "credit score",
  ]) {
    assert.ok(!lower.includes(term), `Forbidden phrase "${term}"`);
  }
});

// ---------------------------------------------------------------------------
// 9. No fake lender behavior
// ---------------------------------------------------------------------------

test("rendered submission components make no fake lender claims", () => {
  const vm = makeVM({
    documents: mkDocs([
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ]),
  });
  const html =
    renderToStaticMarkup(React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionEducationCard, { steps: vm.nextSteps }));
  const lower = html.toLowerCase();

  assert.ok(!lower.includes("has been submitted"));
  assert.ok(!lower.includes("submitted to lender"));
  assert.ok(!lower.includes("lender accepted"));
  assert.ok(!lower.includes("lender match"));
});

// ---------------------------------------------------------------------------
// 10. No fake submission timestamps
// ---------------------------------------------------------------------------

test("rendered submission components contain no fabricated timestamps", () => {
  const vm = makeVM();
  const html =
    renderToStaticMarkup(React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionChecklist, { items: vm.checklist }));
  // Should not contain date patterns unless real
  assert.ok(!html.includes("Submitted on"));
  assert.ok(!html.includes("Submitted at"));
});

// ---------------------------------------------------------------------------
// 11. No forbidden borrower terms across states
// ---------------------------------------------------------------------------

test("no FORBIDDEN_BORROWER_TERMS in rendered submission components", () => {
  const vm = makeVM();
  const html =
    renderToStaticMarkup(React.createElement(BorrowerSubmissionReadinessHero, { viewModel: vm })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionChecklist, { items: vm.checklist })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionAttentionItems, { items: vm.attentionItems })) +
    renderToStaticMarkup(React.createElement(BorrowerSubmissionEducationCard, { steps: vm.nextSteps }));
  const lower = html.toLowerCase();

  for (const term of FORBIDDEN_BORROWER_TERMS) {
    assert.ok(!lower.includes(term.toLowerCase()), `Forbidden borrower term "${term}"`);
  }
});

// ---------------------------------------------------------------------------
// 12. Accessible checklist labels
// ---------------------------------------------------------------------------

test("checklist uses list role and aria-label", () => {
  const vm = makeVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionChecklist, { items: vm.checklist }),
  );
  assert.ok(html.includes('role="list"'));
  assert.ok(html.includes('aria-label="Submission checklist"'));
});

// ---------------------------------------------------------------------------
// 13. Attention item upload CTA has aria-label
// ---------------------------------------------------------------------------

test("attention upload links include aria-label", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerSubmissionAttentionItems, {
      items: [
        {
          id: "1",
          label: "Business Tax Returns",
          description: "Needed for review.",
          priority: "required",
          href: "/upload/t",
        },
      ],
    }),
  );
  assert.ok(html.includes("Respond to Business Tax Returns"));
});
