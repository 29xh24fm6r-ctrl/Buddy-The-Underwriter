import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BorrowerTrustReviewCenter } from "@/components/borrower/trust-review/BorrowerTrustReviewCenter";
import { BorrowerReviewGroupCard } from "@/components/borrower/trust-review/BorrowerReviewGroupCard";
import { BorrowerConfirmationItems } from "@/components/borrower/trust-review/BorrowerConfirmationItems";
import { BorrowerPackageReviewSummary } from "@/components/borrower/trust-review/BorrowerPackageReviewSummary";
import { BorrowerTrustCaveatCard } from "@/components/borrower/trust-review/BorrowerTrustCaveatCard";
import {
  buildBorrowerTrustReviewViewModel,
  type BorrowerTrustReviewInput,
} from "@/lib/borrower/buildBorrowerTrustReviewViewModel";
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
import { buildBorrowerSubmissionReadinessViewModel } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

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
  docs?: BorrowerDocumentItemInput[];
  portalStage?: JourneyInput["portalStage"];
  profile?: BorrowerTrustReviewInput["profile"];
  borrowerName?: string | null;
} = {}) {
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
    { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
    { id: "d3", title: "SBA Form 1919", required: true, status: "needs_attention" },
  ];
  const portalStage = opts.portalStage ?? "additional_items_needed";
  const documents = mkDocs(docs);
  const journey = mkJourney({ portalStage });
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
  return buildBorrowerTrustReviewViewModel({
    token: "t",
    borrowerName: opts.borrowerName ?? "Jane",
    journey,
    guidance,
    communication,
    documents,
    submission,
    profile: opts.profile,
  });
}

// ---------------------------------------------------------------------------
// 1. Full review center rendering
// ---------------------------------------------------------------------------

test("BorrowerTrustReviewCenter renders headline, summary, state label", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Review Your Package"));
  assert.ok(html.includes(vm.headline));
  // The state label should appear
  assert.ok(
    html.includes("Confirm a few details") ||
      html.includes("Ready to review") ||
      html.includes("Waiting on updates") ||
      html.includes("Not ready for review yet"),
  );
});

// ---------------------------------------------------------------------------
// 2. Minimal fallback rendering
// ---------------------------------------------------------------------------

test("BorrowerTrustReviewCenter renders not_ready_to_review fallback safely", () => {
  const vm = mkVM({ docs: [], portalStage: "getting_started" });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Not ready for review yet"));
  // Caveat is always present
  assert.ok(html.includes("lender package"));
});

// ---------------------------------------------------------------------------
// 3. Review group cards render
// ---------------------------------------------------------------------------

test("BorrowerReviewGroupCard renders fields with status pills", () => {
  const vm = mkVM({
    profile: {
      businessLegalName: "Acme LLC",
      primaryContactEmail: "owner@acme.test",
    },
  });
  const business = vm.reviewGroups.find((g) => g.id === "business_information")!;
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReviewGroupCard, { group: business }),
  );
  assert.ok(html.includes("Business information"));
  assert.ok(html.includes("Acme LLC"));
  assert.ok(html.includes("On file"));
});

// ---------------------------------------------------------------------------
// 4. Missing field states
// ---------------------------------------------------------------------------

test("BorrowerReviewGroupCard renders 'Not provided yet' for missing fields", () => {
  const vm = mkVM({ profile: {}, borrowerName: null });
  const business = vm.reviewGroups.find((g) => g.id === "business_information")!;
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReviewGroupCard, { group: business }),
  );
  assert.ok(html.includes("Not provided yet"));
});

// ---------------------------------------------------------------------------
// 5. Confirmation items render
// ---------------------------------------------------------------------------

test("BorrowerConfirmationItems renders confirmation prompts", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerConfirmationItems, {
      items: vm.confirmationItems,
    }),
  );
  assert.ok(html.includes("Open confirmation items"));
  assert.ok(html.includes("Confirm business name and address"));
  assert.ok(html.includes("Confirm ownership details"));
});

test("BorrowerConfirmationItems renders empty markup when no items", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerConfirmationItems, { items: [] }),
  );
  assert.equal(html, "");
});

test("BorrowerConfirmationItems never renders 'Confirmed' pill without confirmed status", () => {
  const vm = mkVM({
    profile: {
      businessLegalName: "Acme LLC",
      primaryContactEmail: "owner@acme.test",
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerConfirmationItems, {
      items: vm.confirmationItems,
    }),
  );
  // No item has confirmed status in our VM today; ensure label "Confirmed"
  // doesn't appear because that would imply a saved confirmation we don't have.
  assert.equal(html.includes(">Confirmed<"), false);
});

// ---------------------------------------------------------------------------
// 6. Package summary renders counts and categories
// ---------------------------------------------------------------------------

test("BorrowerPackageReviewSummary renders required counts and submission label", () => {
  const vm = mkVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerPackageReviewSummary, {
      summary: vm.packageSummary,
    }),
  );
  assert.ok(html.includes("Package review summary"));
  assert.ok(html.includes("Required received"));
  assert.ok(html.includes("Required remaining"));
  assert.ok(html.includes("Needs attention"));
  assert.ok(html.includes(vm.packageSummary.submissionReadinessLabel));
});

// ---------------------------------------------------------------------------
// 7. Trust caveat card renders message
// ---------------------------------------------------------------------------

test("BorrowerTrustCaveatCard renders caveat message and explanation", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustCaveatCard, {
      message:
        "Buddy uses the information and documents provided in your portal to help prepare your lender package. Your banker may still request clarification or updated documents before lender submission preparation.",
    }),
  );
  assert.ok(html.includes("How Buddy uses what you"));
  assert.ok(html.includes("lender package"));
  // Includes the borrower update encouragement / not-a-lending-decision caveat
  // (copy uses the contraction "isn't a lending decision").
  assert.ok(html.toLowerCase().includes("a lending decision"));
});

// ---------------------------------------------------------------------------
// 8. CTA renders only when href exists
// ---------------------------------------------------------------------------

test("primary CTA renders when href is present in VM", () => {
  const vm = mkVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    profile: { updateBusinessHref: "/portal/t/business" },
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
  );
  assert.ok(html.includes('href="/portal/t/business"'));
});

test("no primary CTA rendered when no href is available", () => {
  const vm = mkVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    ],
    portalStage: "documents_requested",
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
  );
  // No update href provided → no anchor in header area for CTA.
  // Confirmation items also won't have hrefs.
  assert.equal(html.includes('href="/portal/t/business"'), false);
});

// ---------------------------------------------------------------------------
// 9. Mobile-safe structure (no tables, has stacking)
// ---------------------------------------------------------------------------

test("trust review components use no tables", () => {
  const vm = mkVM();
  const html =
    renderToStaticMarkup(
      React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
    ) +
    renderToStaticMarkup(
      React.createElement(BorrowerConfirmationItems, {
        items: vm.confirmationItems,
      }),
    ) +
    renderToStaticMarkup(
      React.createElement(BorrowerPackageReviewSummary, {
        summary: vm.packageSummary,
      }),
    );
  assert.ok(!html.includes("<table"));
});

test("confirmation update CTA preserves min-h-11 touch target", () => {
  const html = renderToStaticMarkup(
    React.createElement(BorrowerConfirmationItems, {
      items: [
        {
          id: "x",
          label: "Confirm business name and address",
          description: "Make sure the business details on file match.",
          status: "needs_confirmation",
          href: "/portal/t/business",
        },
      ],
    }),
  );
  assert.ok(html.includes("min-h-11"));
});

// ---------------------------------------------------------------------------
// 10. Accessible status labels
// ---------------------------------------------------------------------------

test("review group card uses semantic region and list roles", () => {
  const vm = mkVM({
    profile: { businessLegalName: "Acme LLC" },
  });
  const business = vm.reviewGroups.find((g) => g.id === "business_information")!;
  const html = renderToStaticMarkup(
    React.createElement(BorrowerReviewGroupCard, { group: business }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('role="list"'));
  assert.ok(html.includes('aria-label="Business information"'));
});

test("confirmation items list has accessible labels", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerConfirmationItems, {
      items: vm.confirmationItems,
    }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Open confirmation items"'));
  assert.ok(html.includes('aria-label="Confirmation items"'));
});

// ---------------------------------------------------------------------------
// 11. No internal enum leakage
// ---------------------------------------------------------------------------

test("trust review components do not leak internal enums or tech terms", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
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

test("no FORBIDDEN_BORROWER_TERMS in rendered trust review", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
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

test("rendered trust review contains no approval/funding guarantee phrases", () => {
  const vm = mkVM({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
  });
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const term of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "you qualify",
    "you are approved",
    "your loan will fund",
    "pre-approved",
    "conditional approval",
    "risk score",
    "credit decision",
  ]) {
    assert.ok(!lower.includes(term), `Forbidden phrase "${term}"`);
  }
});

// ---------------------------------------------------------------------------
// 13. No fake confirmation or timestamp claims
// ---------------------------------------------------------------------------

test("rendered trust review never shows 'Saved on' or 'Confirmed on' timestamps", () => {
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
  );
  assert.ok(!html.includes("Confirmed on"));
  assert.ok(!html.includes("Saved on"));
  assert.ok(!html.includes("Reviewed on"));
});

test("rendered trust review never displays 'Reviewed' state for non-confirmed VM", () => {
  // Because we never produce a confirmed/reviewed state from real input,
  // the "Review saved" header should not appear in default scenarios.
  const vm = mkVM();
  const html = renderToStaticMarkup(
    React.createElement(BorrowerTrustReviewCenter, { viewModel: vm }),
  );
  assert.equal(html.includes("Review saved"), false);
});
