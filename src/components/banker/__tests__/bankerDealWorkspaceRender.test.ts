import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BankerDealWorkspace } from "@/components/banker/BankerDealWorkspace";
import { BankerDealWorkspaceHeader } from "@/components/banker/BankerDealWorkspaceHeader";
import { BankerWorkspaceNavigation } from "@/components/banker/BankerWorkspaceNavigation";
import {
  buildDealIntelligenceWorkspace,
  type BankerDealIntelligenceInput,
} from "@/lib/banker/buildDealIntelligenceWorkspace";
import {
  buildBorrowerOperationalContinuityViewModel,
  type BorrowerOperationalContinuityInput,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
import { buildSubmissionOrchestrationViewModel } from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import { buildLenderRoutingFitViewModel } from "@/lib/banker/buildLenderRoutingFitViewModel";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";
import { buildBorrowerReadinessViewModel } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import { buildBorrowerDealHealthViewModel } from "@/lib/borrower/buildBorrowerDealHealthViewModel";
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

// ---------------------------------------------------------------------------
// Helpers (mirror VM tests)
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
  const continuityInput: BorrowerOperationalContinuityInput = {
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
  };
  const continuity = buildBorrowerOperationalContinuityViewModel(continuityInput);
  const orchestration = buildSubmissionOrchestrationViewModel({
    dealId,
    documents,
    communication,
    submission,
    trustReview,
    continuity,
  });
  const routing = buildLenderRoutingFitViewModel({
    dealId,
    dealProfile: {
      loanAmount: 500_000,
      state: "CA",
      industry: "Restaurant",
      useOfProceeds: "acquisition",
      businessStage: "existing",
      franchiseStatus: "non_franchise",
    },
    orchestration,
    continuity,
  });
  return { continuity, orchestration, routing };
}

function buildWorkspaceVm(opts: Partial<BankerDealIntelligenceInput> = {}) {
  const stack = buildStack();
  return buildDealIntelligenceWorkspace({
    dealId: "deal-1",
    dealLabel: "Acme Holdings",
    borrowerLabel: "Acme Holdings",
    continuity: stack.continuity,
    orchestration: stack.orchestration,
    routing: stack.routing,
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// 1. Full workspace renders all 3 advanced panels + header + nav
// ---------------------------------------------------------------------------

test("BankerDealWorkspace renders header, navigation, and the 3 advanced panels", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  assert.ok(html.includes("Banker deal workspace"));
  assert.ok(html.includes("Acme Holdings"));
  // Continuity panel
  assert.ok(html.includes("Borrower intake brief"));
  // Orchestration workspace
  assert.ok(html.includes("Submission orchestration"));
  // Routing workspace
  assert.ok(html.includes("Lender routing intelligence"));
  // Navigation
  assert.ok(html.includes("Banker deal workspace navigation"));
});

// ---------------------------------------------------------------------------
// 2. Minimal fallback workspace
// ---------------------------------------------------------------------------

test("workspace renders fallback copy when no advanced workspaces are visible", () => {
  const ws = buildDealIntelligenceWorkspace({
    dealId: "deal-1",
    dealLabel: "Acme Holdings",
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  assert.ok(html.includes("Acme Holdings"));
  assert.ok(
    html.includes("Additional operational intelligence will appear"),
  );
});

// ---------------------------------------------------------------------------
// 3. Workspace navigation visibility-gates items
// ---------------------------------------------------------------------------

test("workspace navigation only renders visible items", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerWorkspaceNavigation, { items: ws.navigation }),
  );
  // Overview always visible
  assert.ok(html.includes(">Overview<"));
  // Orchestration visible
  assert.ok(html.includes(">Orchestration<"));
  // Routing visible
  assert.ok(html.includes(">Routing Fit<"));
  // Submission Prep is not yet wired → not visible
  assert.equal(html.includes(">Submission Prep<"), false);
});

test("workspace navigation renders nothing when no items are visible", () => {
  // Build a workspace where everything is missing — overview is still visible
  // by default, so navigation should still render at least one item.
  const ws = buildDealIntelligenceWorkspace({ dealId: "deal-1" });
  const html = renderToStaticMarkup(
    React.createElement(BankerWorkspaceNavigation, { items: ws.navigation }),
  );
  // Overview alone is always present
  assert.ok(html.includes(">Overview<"));
});

// ---------------------------------------------------------------------------
// 4. Cross-link anchors render on workspace sections
// ---------------------------------------------------------------------------

test("workspace renders anchor ids matching the navigation hrefs", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  assert.ok(html.includes('id="workspace-overview"'));
  assert.ok(html.includes('id="workspace-orchestration"'));
  assert.ok(html.includes('id="workspace-routing"'));
});

test("nav anchor hrefs point to corresponding section ids", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerWorkspaceNavigation, { items: ws.navigation }),
  );
  assert.ok(html.includes('href="#workspace-orchestration"'));
  assert.ok(html.includes('href="#workspace-routing"'));
});

// ---------------------------------------------------------------------------
// 5. Header next-action CTA only when href present
// ---------------------------------------------------------------------------

test("header renders 'Open next action' CTA only when an href flows through", () => {
  const stack = buildStack();
  const ws = buildWorkspaceVm({
    orchestration: {
      ...stack.orchestration,
      nextAction: {
        ...stack.orchestration.nextAction,
        href: "/banker/deals/deal-1/orchestration",
      },
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  assert.ok(html.includes("Open next action"));
  assert.ok(html.includes('href="/banker/deals/deal-1/orchestration"'));
});

test("header CTA hidden when nextAction has no href", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  // Default factories pass no hrefs → header renders no "Open next action"
  assert.equal(html.includes("Open next action"), false);
});

// ---------------------------------------------------------------------------
// 6. Dark-theme classes
// ---------------------------------------------------------------------------

test("workspace renders dark-theme color tokens overall", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  // Full workspace must include dark surface tokens overall.
  assert.ok(html.includes("text-white"));
});

test("header + navigation (new in 15T) carry no light-theme leaks", () => {
  // Scope the leak guard to the components introduced by this spec — the
  // legacy continuity panel (15N) uses its own theming and is harmonized in
  // a follow-up spec.
  const ws = buildWorkspaceVm();
  const headerHtml = renderToStaticMarkup(
    React.createElement(BankerDealWorkspaceHeader, { header: ws.header }),
  );
  const navHtml = renderToStaticMarkup(
    React.createElement(BankerWorkspaceNavigation, { items: ws.navigation }),
  );
  for (const html of [headerHtml, navHtml]) {
    assert.equal(
      /\bbg-stone-50\b/.test(html),
      false,
      "header/nav must not leak light-theme bg-stone-50",
    );
    assert.ok(html.includes("text-white"));
  }
});

// ---------------------------------------------------------------------------
// 7. Accessibility — landmarks and nav labels
// ---------------------------------------------------------------------------

test("workspace exposes a region role and accessible labels", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Banker deal workspace"'));
  assert.ok(html.includes('aria-label="Deal workspace header"'));
});

test("workspace navigation uses semantic <nav> with aria-label", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerWorkspaceNavigation, { items: ws.navigation }),
  );
  assert.ok(html.includes("<nav"));
  assert.ok(html.includes('aria-label="Banker deal workspace navigation"'));
  assert.ok(html.includes('role="list"'));
});

// ---------------------------------------------------------------------------
// 8. No duplicate timeline explosion
// ---------------------------------------------------------------------------

test("workspace exposes only a single canonical orchestration timeline header", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  const orchTimelineHits = html.split("Orchestration timeline").length - 1;
  assert.equal(orchTimelineHits, 1, "Expected one orchestration timeline header");
  // The continuity panel's "Recent activity" stays distinct from orchestration's timeline.
  const recentActivityHits = html.split("Recent activity").length - 1;
  assert.ok(recentActivityHits <= 1, "Expected at most one canonical 'Recent activity' header");
});

// ---------------------------------------------------------------------------
// 9. No internal enum leakage / forbidden terms
// ---------------------------------------------------------------------------

test("workspace does not leak internal enums or tech terms", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  const lower = html.toLowerCase();
  for (const term of [
    "docs_in_progress",
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

// ---------------------------------------------------------------------------
// 10. No approval / funding / fake lender behavior
// ---------------------------------------------------------------------------

test("workspace renders no approval/funding/guarantee phrases", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  const lower = html.toLowerCase();
  for (const phrase of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "borrower qualifies",
    "loan will fund",
    "pre-approved",
    "conditional approval",
    "risk score",
    "credit decision",
    "best lender",
    "will accept",
    "highest chance",
    "match score",
  ]) {
    assert.ok(!lower.includes(phrase), `Forbidden phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 11. Responsive-safe / no tables
// ---------------------------------------------------------------------------

test("workspace renders no tables", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspace, { workspace: ws }),
  );
  assert.ok(!html.includes("<table"));
});

// ---------------------------------------------------------------------------
// 12. Header standalone
// ---------------------------------------------------------------------------

test("BankerDealWorkspaceHeader renders all four state summaries", () => {
  const ws = buildWorkspaceVm();
  const html = renderToStaticMarkup(
    React.createElement(BankerDealWorkspaceHeader, { header: ws.header }),
  );
  assert.ok(html.includes("Operational state"));
  assert.ok(html.includes("Submission readiness"));
  assert.ok(html.includes("Routing readiness"));
  assert.ok(html.includes("Waiting on"));
  assert.ok(html.includes("Unresolved"));
});
