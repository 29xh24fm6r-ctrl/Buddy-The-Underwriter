import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BankerCommandCenter } from "@/components/command-center/BankerCommandCenter";
import { BankerWorkloadSummaryCards } from "@/components/command-center/BankerWorkloadSummaryCards";
import { BankerOperationalQueueSection } from "@/components/command-center/BankerOperationalQueueSection";
import { BankerDealQueueCard } from "@/components/command-center/BankerDealQueueCard";
import { BankerPriorityBadge } from "@/components/command-center/BankerPriorityBadge";
import { BankerOperationalStalenessPill } from "@/components/command-center/BankerOperationalStalenessPill";
import { BankerRecentlyActiveSection } from "@/components/command-center/BankerRecentlyActiveSection";
import {
  buildBankerCommandCenterViewModel,
  type BankerCommandCenterDealInput,
} from "@/lib/banker/buildBankerCommandCenterViewModel";
import {
  buildBorrowerOperationalContinuityViewModel,
  type BorrowerOperationalContinuityInput,
} from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
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
// Helpers — same shape as VM test factories
// ---------------------------------------------------------------------------

type PortalStage = JourneyInput["portalStage"];

function buildContinuity(opts: {
  dealId: string;
  docs?: BorrowerDocumentItemInput[];
  portalStage?: PortalStage;
  blockers?: CommunicationInput["blockers"];
}) {
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    { id: "d2", title: "Balance Sheet", required: true, status: "received" },
  ];
  const portalStage = opts.portalStage ?? "additional_items_needed";
  const documents = buildBorrowerDocumentExperienceViewModel({ token: opts.dealId, items: docs });
  const baseDealOpts = {
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
    token: opts.dealId,
  };
  const journey = buildBorrowerJourneyViewModel({
    dealName: "Acme",
    ...baseDealOpts,
  });
  const readiness = buildBorrowerReadinessViewModel({
    ...baseDealOpts,
    docsVerified: 3,
    activity: [],
  });
  const dealHealth = buildBorrowerDealHealthViewModel({
    ...baseDealOpts,
    docsVerified: 3,
    financialDocTypes: [],
    financialPeriods: [],
    extractedFinancialFields: [],
  });
  const guidance = buildBorrowerGuidanceViewModel({
    ...baseDealOpts,
    docsVerified: 3,
    readinessScore: 45,
    hasActivity: true,
    recommendationCount: 0,
  });
  const communication = buildBorrowerCommunicationViewModel({
    borrowerName: "Jane",
    token: opts.dealId,
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
    token: opts.dealId,
    journey,
    guidance,
    communication,
    documents,
  });
  const mobileCommand = buildBorrowerMobileCommandViewModel({
    borrowerName: "Jane",
    token: opts.dealId,
    journey,
    readiness,
    guidance,
    communication,
    documents,
  });
  const trustReview = buildBorrowerTrustReviewViewModel({
    token: opts.dealId,
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
    dealId: opts.dealId,
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
  return buildBorrowerOperationalContinuityViewModel(continuityInput);
}

function deal(
  dealId: string,
  opts: Parameters<typeof buildContinuity>[0] & {
    borrowerLabel?: string;
    lastActivityAt?: string;
    topBlocker?: string;
    href?: string;
  } = { dealId: "d-1" },
): BankerCommandCenterDealInput {
  const continuity = buildContinuity({ ...opts, dealId });
  const out: BankerCommandCenterDealInput = {
    dealId,
    borrowerLabel: opts.borrowerLabel ?? `Borrower ${dealId}`,
    continuity,
  };
  if (opts.lastActivityAt) out.lastActivityAt = opts.lastActivityAt;
  if (opts.topBlocker) out.topBlocker = opts.topBlocker;
  if (opts.href) out.href = opts.href;
  return out;
}

function buildVM(opts: { evaluatedAt?: string } = {}) {
  const deals = [
    deal("d-blocked", {
      dealId: "d-blocked",
      blockers: [{ id: "b", label: "Critical", severity: "critical" }],
      lastActivityAt: "2026-05-19T00:00:00.000Z",
      topBlocker: "Borrower experience surfaced a critical block",
      href: "/banker/deals/d-blocked/discovery",
    }),
    deal("d-borrower", {
      dealId: "d-borrower",
      lastActivityAt: "2026-05-19T00:00:00.000Z",
      href: "/banker/deals/d-borrower/discovery",
    }),
    deal("d-submit", {
      dealId: "d-submit",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
      lastActivityAt: "2026-05-18T00:00:00.000Z",
      href: "/banker/deals/d-submit/discovery",
    }),
  ];
  return buildBankerCommandCenterViewModel({
    deals,
    evaluatedAt: opts.evaluatedAt ?? "2026-05-20T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// 1. Command center overview renders
// ---------------------------------------------------------------------------

test("BankerCommandCenter renders header, summary, and sections", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Banker command center"));
  assert.ok(html.includes("Operational overview"));
  assert.ok(html.includes("Banker workload summary"));
  assert.ok(html.includes("Operationally Blocked"));
  assert.ok(html.includes("Ready for Submission Prep"));
  assert.ok(html.includes("Waiting on Borrower"));
});

test("BankerCommandCenter renders empty-pipeline copy when no deals", () => {
  const vm = buildBankerCommandCenterViewModel({ deals: [] });
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("No active deals on the queue"));
});

// ---------------------------------------------------------------------------
// 2. Workload summary cards
// ---------------------------------------------------------------------------

test("BankerWorkloadSummaryCards renders all 6 buckets", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerWorkloadSummaryCards, { summary: vm.summary }),
  );
  assert.ok(html.includes("Banker action"));
  assert.ok(html.includes("Borrower action"));
  assert.ok(html.includes("Ready for submission prep"));
  assert.ok(html.includes("Stalled deals"));
  assert.ok(html.includes("Operationally blocked"));
  assert.ok(html.includes("Open attention items"));
});

// ---------------------------------------------------------------------------
// 3. Queue section rendering
// ---------------------------------------------------------------------------

test("BankerOperationalQueueSection renders deal cards inside", () => {
  const vm = buildVM();
  const section = vm.sections.find((s) => s.id === "operationally_blocked");
  assert.ok(section);
  const html = renderToStaticMarkup(
    React.createElement(BankerOperationalQueueSection, { section }),
  );
  assert.ok(html.includes("Operationally Blocked"));
  assert.ok(html.includes("Borrower d-blocked"));
});

test("BankerOperationalQueueSection renders nothing for empty items", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerOperationalQueueSection, {
      section: { id: "monitoring", label: "Monitoring", items: [] },
    }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 4. Deal queue card content
// ---------------------------------------------------------------------------

test("BankerDealQueueCard renders next best action, waiting state, and CTA", () => {
  const vm = buildVM();
  const item = vm.sections
    .flatMap((s) => s.items)
    .find((i) => i.dealId === "d-submit");
  assert.ok(item);
  const html = renderToStaticMarkup(
    React.createElement(BankerDealQueueCard, { item }),
  );
  assert.ok(html.includes("Borrower d-submit"));
  assert.ok(html.includes("Next best action"));
  assert.ok(html.includes('href="/banker/deals/d-submit/discovery"'));
  assert.ok(html.includes("min-h-11"));
});

test("BankerDealQueueCard hides CTA when href missing", () => {
  const vm = buildBankerCommandCenterViewModel({
    deals: [deal("d-no-href", { dealId: "d-no-href" })],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.ok(item);
  const html = renderToStaticMarkup(
    React.createElement(BankerDealQueueCard, { item }),
  );
  assert.equal(html.includes('href="/banker'), false);
});

test("BankerDealQueueCard surfaces top blocker copy when provided", () => {
  const item = buildBankerCommandCenterViewModel({
    deals: [
      deal("d-x", {
        dealId: "d-x",
        topBlocker: "Tax return still missing",
        blockers: [{ id: "b", label: "Critical", severity: "critical" }],
      }),
    ],
  }).sections.flatMap((s) => s.items)[0];
  assert.ok(item);
  const html = renderToStaticMarkup(
    React.createElement(BankerDealQueueCard, { item }),
  );
  assert.ok(html.includes("Top blocker"));
  assert.ok(html.includes("Tax return still missing"));
});

// ---------------------------------------------------------------------------
// 5. Priority badge
// ---------------------------------------------------------------------------

test("BankerPriorityBadge renders label and accessible status role", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerPriorityBadge, { band: "immediate_attention" }),
  );
  assert.ok(html.includes("Immediate attention"));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('aria-label="Priority: Immediate attention"'));
});

test("BankerPriorityBadge uses non-color-only glyph", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerPriorityBadge, { band: "immediate_attention" }),
  );
  // The badge includes a glyph character in addition to the color dot.
  // Star symbol is used for immediate_attention.
  assert.ok(html.includes("★") || html.includes("&#x"));
});

// ---------------------------------------------------------------------------
// 6. Staleness pill
// ---------------------------------------------------------------------------

test("BankerOperationalStalenessPill renders label and days", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerOperationalStalenessPill, {
      staleness: "stalled",
      daysSinceLastActivity: 14,
    }),
  );
  assert.ok(html.includes("Stalled"));
  assert.ok(html.includes("14d"));
  assert.ok(html.includes('role="status"'));
});

test("BankerOperationalStalenessPill omits days suffix when zero", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerOperationalStalenessPill, {
      staleness: "recently_active",
      daysSinceLastActivity: 0,
    }),
  );
  assert.equal(html.includes("0d"), false);
  assert.ok(html.includes("Recently active"));
});

// ---------------------------------------------------------------------------
// 7. Recently active section
// ---------------------------------------------------------------------------

test("BankerRecentlyActiveSection renders compact rows with hrefs", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerRecentlyActiveSection, {
      items: vm.recentlyActive,
    }),
  );
  if (vm.recentlyActive.length > 0) {
    assert.ok(html.includes("Recently active"));
    assert.ok(html.includes("Open"));
  } else {
    assert.equal(html, "");
  }
});

test("BankerRecentlyActiveSection renders nothing when empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(BankerRecentlyActiveSection, { items: [] }),
  );
  assert.equal(html, "");
});

// ---------------------------------------------------------------------------
// 8. Accessibility
// ---------------------------------------------------------------------------

test("queue sections use region roles and aria-labels", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Banker command center"'));
  assert.ok(html.includes('aria-label="Operationally Blocked"'));
});

test("deal queue card exposes aria-label for the deal", () => {
  const vm = buildVM();
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.ok(item);
  const html = renderToStaticMarkup(
    React.createElement(BankerDealQueueCard, { item }),
  );
  assert.ok(html.includes(`aria-label="Deal ${item.borrowerLabel}"`));
});

// ---------------------------------------------------------------------------
// 9. No internal enum leakage / no forbidden terms
// ---------------------------------------------------------------------------

test("command center does not leak internal enums or tech terms", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
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

test("no FORBIDDEN_BORROWER_TERMS leak into the command center", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
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
// 10. No approval / funding guarantee language
// ---------------------------------------------------------------------------

test("command center renders no approval/funding guarantee phrases", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
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
// 11. No tables and dark-theme-safe structure
// ---------------------------------------------------------------------------

test("command center renders without tables", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(!html.includes("<table"));
});

test("command center renders dark-theme color tokens (text-white)", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("text-white"));
});

// ---------------------------------------------------------------------------
// 12. No fake banker notes / SLA / timestamps
// ---------------------------------------------------------------------------

test("command center renders no fake banker notes", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  assert.ok(!lower.includes("banker noted"));
  assert.ok(!lower.includes("note added by banker"));
});

test("command center renders no SLA countdown copy", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BankerCommandCenter, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  assert.ok(!lower.includes("sla"));
  assert.ok(!lower.includes("response due in"));
  assert.ok(!lower.includes("countdown"));
});
