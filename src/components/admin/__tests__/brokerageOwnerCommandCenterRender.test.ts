import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrokerageOwnerCommandCenter } from "@/components/admin/BrokerageOwnerCommandCenter";
import { BrokeragePipelineSummaryCards } from "@/components/admin/BrokeragePipelineSummaryCards";
import { BrokerageBottlenecksPanel } from "@/components/admin/BrokerageBottlenecksPanel";
import { BrokerageTeamWorkloadTable } from "@/components/admin/BrokerageTeamWorkloadTable";
import { ExecutiveAttentionQueue } from "@/components/admin/ExecutiveAttentionQueue";
import { SubmissionPipelineOverview } from "@/components/admin/SubmissionPipelineOverview";
import { BrokerageActivityFeed } from "@/components/admin/BrokerageActivityFeed";
import { OwnerDailyBrief } from "@/components/admin/OwnerDailyBrief";
import {
  buildBrokerageOwnerCommandCenterViewModel,
  type BrokerageDealRecord,
  type BrokerageTeamMember,
  type BrokerageActivityEvent,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import { buildBorrowerOperationalContinuityViewModel } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";
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
// Helpers
// ---------------------------------------------------------------------------

type PortalStage = JourneyInput["portalStage"];

function buildStack(opts: {
  dealId: string;
  docs?: BorrowerDocumentItemInput[];
  portalStage?: PortalStage;
  blockers?: CommunicationInput["blockers"];
}) {
  const dealId = opts.dealId;
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

function makeDeal(
  dealId: string,
  opts: Parameters<typeof buildStack>[0] & {
    assignedTeamMemberId?: string;
    lastActivityAt?: string;
  } = { dealId: "deal-1" },
): BrokerageDealRecord {
  const stack = buildStack({ ...opts, dealId });
  const record: BrokerageDealRecord = {
    dealId,
    borrowerLabel: `Acme ${dealId}`,
    continuity: stack.continuity,
    orchestration: stack.orchestration,
    routing: stack.routing,
  };
  if (opts.assignedTeamMemberId) record.assignedTeamMemberId = opts.assignedTeamMemberId;
  if (opts.lastActivityAt) record.lastActivityAt = opts.lastActivityAt;
  return record;
}

function buildVM(opts: {
  deals?: BrokerageDealRecord[];
  team?: BrokerageTeamMember[];
  activity?: BrokerageActivityEvent[];
  evaluatedAt?: string;
  submittedDeals?: number;
} = {}) {
  return buildBrokerageOwnerCommandCenterViewModel({
    deals: opts.deals ?? [],
    team: opts.team,
    activity: opts.activity,
    evaluatedAt: opts.evaluatedAt,
    submittedDeals: opts.submittedDeals,
  });
}

// ---------------------------------------------------------------------------
// 1. Full owner command center
// ---------------------------------------------------------------------------

test("BrokerageOwnerCommandCenter renders header, pipeline, daily brief, exec queue, pipeline overview, bottlenecks, workload, activity", () => {
  const team: BrokerageTeamMember[] = [
    { id: "user-a", name: "Alice", role: "banker" },
  ];
  const deals = [
    makeDeal("d-1", { dealId: "d-1", assignedTeamMemberId: "user-a" }),
    makeDeal("d-2", { dealId: "d-2" }),
  ];
  const activity: BrokerageActivityEvent[] = [
    { id: "a1", label: "Borrower uploaded Tax Return", timestamp: "2026-05-19T00:00:00.000Z", category: "borrower" },
  ];
  const vm = buildVM({ deals, team, activity });
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Brokerage owner command center"));
  assert.ok(html.includes("Brokerage pipeline summary"));
  assert.ok(html.includes("Owner daily brief"));
  assert.ok(html.includes("Executive attention"));
  assert.ok(html.includes("Submission pipeline"));
  assert.ok(html.includes("Operational bottlenecks"));
  assert.ok(html.includes("Team workload"));
  assert.ok(html.includes("Activity feed"));
});

// ---------------------------------------------------------------------------
// 2. Minimal fallback
// ---------------------------------------------------------------------------

test("workspace renders calm minimal-state copy when no deals exist", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("No active deals in the pipeline yet"));
  assert.ok(html.includes("No major operational issues"));
  assert.ok(html.includes("No operational bottlenecks surfaced"));
});

// ---------------------------------------------------------------------------
// 3. Summary cards
// ---------------------------------------------------------------------------

test("BrokeragePipelineSummaryCards renders 8 base cards", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BrokeragePipelineSummaryCards, { pipeline: vm.pipeline }),
  );
  assert.ok(html.includes("Active deals"));
  assert.ok(html.includes("Banker action required"));
  assert.ok(html.includes("Borrower action required"));
  assert.ok(html.includes("Submission-prep ready"));
  assert.ok(html.includes("Routing review ready"));
  assert.ok(html.includes("Open clarifications"));
  assert.ok(html.includes("Stalled deals"));
  assert.ok(html.includes("Recently active"));
});

test("BrokeragePipelineSummaryCards adds submitted/funded only when supplied", () => {
  const vm = buildVM({ submittedDeals: 3 });
  const html = renderToStaticMarkup(
    React.createElement(BrokeragePipelineSummaryCards, { pipeline: vm.pipeline }),
  );
  assert.ok(html.includes("Submitted"));
});

// ---------------------------------------------------------------------------
// 4. Bottlenecks panel
// ---------------------------------------------------------------------------

test("BrokerageBottlenecksPanel renders severity pill and description", () => {
  const deals = Array.from({ length: 16 }, (_, i) =>
    makeDeal(`d-${i}`, { dealId: `d-${i}` }),
  );
  const vm = buildVM({ deals });
  const html = renderToStaticMarkup(
    React.createElement(BrokerageBottlenecksPanel, { bottlenecks: vm.bottlenecks }),
  );
  assert.ok(html.includes("Operational bottlenecks"));
  assert.ok(html.includes("Severity: Critical"));
});

test("BrokerageBottlenecksPanel renders empty-state copy when none", () => {
  const html = renderToStaticMarkup(
    React.createElement(BrokerageBottlenecksPanel, { bottlenecks: [] }),
  );
  assert.ok(html.includes("No operational bottlenecks surfaced"));
});

// ---------------------------------------------------------------------------
// 5. Team workload
// ---------------------------------------------------------------------------

test("BrokerageTeamWorkloadTable renders entries with role and stat counts", () => {
  const team: BrokerageTeamMember[] = [
    { id: "user-a", name: "Alice", role: "banker" },
  ];
  const deals = [
    makeDeal("d-1", { dealId: "d-1", assignedTeamMemberId: "user-a" }),
    makeDeal("d-2", { dealId: "d-2", assignedTeamMemberId: "user-a" }),
  ];
  const vm = buildVM({ deals, team });
  const html = renderToStaticMarkup(
    React.createElement(BrokerageTeamWorkloadTable, { workload: vm.workload }),
  );
  assert.ok(html.includes("Alice"));
  assert.ok(html.includes("Banker"));
  assert.ok(html.includes("2 active"));
});

test("BrokerageTeamWorkloadTable renders empty-state when no team data", () => {
  const html = renderToStaticMarkup(
    React.createElement(BrokerageTeamWorkloadTable, { workload: [] }),
  );
  assert.ok(html.includes("Team workload will appear"));
});

// ---------------------------------------------------------------------------
// 6. Executive attention queue
// ---------------------------------------------------------------------------

test("ExecutiveAttentionQueue renders severity-tagged items", () => {
  const team: BrokerageTeamMember[] = [
    { id: "user-a", name: "Alice", role: "banker" },
  ];
  const deals = Array.from({ length: 9 }, (_, i) =>
    makeDeal(`d-${i}`, { dealId: `d-${i}`, assignedTeamMemberId: "user-a" }),
  );
  const vm = buildVM({ deals, team });
  const html = renderToStaticMarkup(
    React.createElement(ExecutiveAttentionQueue, { items: vm.executiveAttention }),
  );
  assert.ok(html.includes("Executive attention"));
  assert.ok(html.includes("Alice is operationally loaded"));
});

test("ExecutiveAttentionQueue renders empty-state when no items", () => {
  const html = renderToStaticMarkup(
    React.createElement(ExecutiveAttentionQueue, { items: [] }),
  );
  assert.ok(html.includes("No items require executive attention"));
});

// ---------------------------------------------------------------------------
// 7. Submission pipeline overview
// ---------------------------------------------------------------------------

test("SubmissionPipelineOverview renders all 5 state buckets", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(SubmissionPipelineOverview, { pipeline: vm.submissionPipeline }),
  );
  assert.ok(html.includes("Submission pipeline"));
  assert.ok(html.includes("Preparing package"));
  assert.ok(html.includes("Awaiting clarifications"));
  assert.ok(html.includes("Ready for submission"));
  assert.ok(html.includes("Submission in progress"));
  assert.ok(html.includes("Submitted"));
});

// ---------------------------------------------------------------------------
// 8. Activity feed
// ---------------------------------------------------------------------------

test("BrokerageActivityFeed renders events newest first", () => {
  const activity: BrokerageActivityEvent[] = [
    { id: "a1", label: "Older event", timestamp: "2026-05-10T00:00:00.000Z", category: "borrower" },
    { id: "a2", label: "Newer event", timestamp: "2026-05-15T00:00:00.000Z", category: "submission" },
  ];
  const vm = buildVM({ activity });
  const html = renderToStaticMarkup(
    React.createElement(BrokerageActivityFeed, { activity: vm.activity }),
  );
  const newerIdx = html.indexOf("Newer event");
  const olderIdx = html.indexOf("Older event");
  assert.ok(newerIdx !== -1);
  assert.ok(olderIdx !== -1);
  assert.ok(newerIdx < olderIdx);
});

test("BrokerageActivityFeed renders empty-state when no events", () => {
  const html = renderToStaticMarkup(
    React.createElement(BrokerageActivityFeed, { activity: [] }),
  );
  assert.ok(html.includes("No recent operational activity"));
});

// ---------------------------------------------------------------------------
// 9. Daily brief
// ---------------------------------------------------------------------------

test("OwnerDailyBrief renders bullet list", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(OwnerDailyBrief, { bullets: vm.dailyBrief }),
  );
  assert.ok(html.includes("Owner daily brief"));
  assert.ok(html.includes("<ul"));
});

// ---------------------------------------------------------------------------
// 10. Dark-theme tokens
// ---------------------------------------------------------------------------

test("admin command center renders dark-theme color tokens", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("text-white"));
  assert.equal(
    /\bbg-stone-50\b/.test(html),
    false,
    "must not leak light-theme bg-stone-50",
  );
});

// ---------------------------------------------------------------------------
// 11. Accessibility — landmarks
// ---------------------------------------------------------------------------

test("admin command center exposes region roles and aria-labels", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Brokerage owner command center"'));
  assert.ok(html.includes('aria-label="Brokerage pipeline summary"'));
  assert.ok(html.includes('aria-label="Owner daily brief"'));
  assert.ok(html.includes('aria-label="Executive attention queue"'));
  assert.ok(html.includes('aria-label="Submission pipeline overview"'));
  assert.ok(html.includes('aria-label="Operational bottlenecks"'));
  assert.ok(html.includes('aria-label="Team workload"'));
  assert.ok(html.includes('aria-label="Brokerage activity feed"'));
});

// ---------------------------------------------------------------------------
// 12. No internal enum leakage / forbidden terms
// ---------------------------------------------------------------------------

test("admin command center does not leak internal enums or tech terms", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
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
// 13. No approval / forecasting language
// ---------------------------------------------------------------------------

test("admin command center renders no approval/funding/forecasting phrases", () => {
  const deals = [makeDeal("d-1", { dealId: "d-1" })];
  const vm = buildVM({ deals, submittedDeals: 2 });
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  const lower = html.toLowerCase();
  for (const phrase of [
    "approval odds",
    "guaranteed funding",
    "probability of approval",
    "lender acceptance probability",
    "borrower qualifies",
    "loan will fund",
    "pre-approved",
    "conditional approval",
    "risk score",
    "credit decision",
    "revenue forecast",
    "expected revenue",
    "approval probability",
    "approval score",
  ]) {
    assert.ok(!lower.includes(phrase), `Forbidden phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 14. No tables / no fake timestamps when nothing supplied
// ---------------------------------------------------------------------------

test("admin command center renders no tables", () => {
  const vm = buildVM({ deals: [makeDeal("d-1", { dealId: "d-1" })] });
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  assert.ok(!html.includes("<table"));
});

test("admin command center contains no ISO timestamps when activity is absent", () => {
  const vm = buildVM({ deals: [makeDeal("d-1", { dealId: "d-1" })] });
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(html), false);
});

// ---------------------------------------------------------------------------
// 15. Hero framing copy
// ---------------------------------------------------------------------------

test("workspace header reminds viewer this is operational, not approval prediction", () => {
  const vm = buildVM();
  const html = renderToStaticMarkup(
    React.createElement(BrokerageOwnerCommandCenter, { viewModel: vm }),
  );
  assert.ok(html.includes("Operational visibility"));
  assert.ok(html.toLowerCase().includes("not approval prediction"));
});
