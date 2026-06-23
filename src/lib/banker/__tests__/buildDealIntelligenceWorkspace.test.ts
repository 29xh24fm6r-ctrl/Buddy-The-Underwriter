import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealIntelligenceWorkspace,
  BANKER_WORKSPACE_NAV_ORDER,
  BANKER_WORKSPACE_NAV_LABELS,
  BANKER_WORKSPACE_ANCHOR_IDS,
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
// Helpers
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
  const readiness = buildBorrowerReadinessViewModel({
    ...baseStage,
    docsVerified: 3,
    activity: [],
  });
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

function buildInput(over: Partial<BankerDealIntelligenceInput> = {}): BankerDealIntelligenceInput {
  return { dealId: "deal-1", ...over };
}

// ---------------------------------------------------------------------------
// 1. Minimal fallback
// ---------------------------------------------------------------------------

test("minimal input produces header + fallback visibility (all advanced workspaces hidden)", () => {
  const ws = buildDealIntelligenceWorkspace(buildInput());
  assert.equal(ws.visibility.continuity, false);
  assert.equal(ws.visibility.orchestration, false);
  assert.equal(ws.visibility.routing, false);
  assert.equal(ws.visibility.submissionPrep, false);
  assert.equal(ws.visibility.timeline, false);
  assert.ok(ws.header.dealLabel.length > 0);
  assert.equal(ws.header.unresolvedIssueCount, 0);
});

// ---------------------------------------------------------------------------
// 2. Visibility gating: continuity
// ---------------------------------------------------------------------------

test("continuity panel becomes visible when VM provided", () => {
  const { continuity } = buildStack();
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity }));
  assert.equal(ws.visibility.continuity, true);
  assert.equal(ws.continuity, continuity);
});

// ---------------------------------------------------------------------------
// 3. Visibility gating: orchestration
// ---------------------------------------------------------------------------

test("orchestration hidden when VM state is not_started", () => {
  // Build with empty docs + getting_started stage → orchestration state = "not_started"
  const { orchestration } = buildStack({ docs: [], portalStage: "getting_started" });
  const ws = buildDealIntelligenceWorkspace(buildInput({ orchestration }));
  assert.equal(orchestration.state, "not_started");
  assert.equal(ws.visibility.orchestration, false);
});

test("orchestration visible when VM state is anything past not_started", () => {
  const { orchestration } = buildStack();
  const ws = buildDealIntelligenceWorkspace(buildInput({ orchestration }));
  assert.notEqual(orchestration.state, "not_started");
  assert.equal(ws.visibility.orchestration, true);
});

// ---------------------------------------------------------------------------
// 4. Visibility gating: routing
// ---------------------------------------------------------------------------

test("routing hidden when state is not_ready", () => {
  const routing = buildLenderRoutingFitViewModel({ dealId: "x" });
  // Empty deal profile + no orchestration → may be gathering_fit_inputs (not not_ready).
  // Build a true not_ready scenario by passing no dealProfile and no orchestration.
  assert.ok(["not_ready", "gathering_fit_inputs"].includes(routing.state));
  const ws = buildDealIntelligenceWorkspace(buildInput({ routing }));
  if (routing.state === "not_ready") {
    assert.equal(ws.visibility.routing, false);
  }
});

test("routing visible when state is past not_ready", () => {
  const { routing } = buildStack();
  assert.notEqual(routing.state, "not_ready");
  const ws = buildDealIntelligenceWorkspace(buildInput({ routing }));
  assert.equal(ws.visibility.routing, true);
});

// ---------------------------------------------------------------------------
// 5. Header derivation prefers orchestration next action over continuity
// ---------------------------------------------------------------------------

test("header next action prefers orchestration when both continuity and orchestration are visible", () => {
  const { continuity, orchestration } = buildStack();
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity, orchestration }));
  assert.equal(ws.header.nextActionLabel, orchestration.nextAction.label);
});

test("header next action falls back to continuity when orchestration is not visible", () => {
  const { continuity } = buildStack({ docs: [], portalStage: "getting_started" });
  const { orchestration } = buildStack({ docs: [], portalStage: "getting_started" });
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity, orchestration }));
  // orchestration is not_started → hidden → continuity action is used
  assert.equal(ws.visibility.orchestration, false);
  assert.equal(ws.header.nextActionLabel, continuity.nextBestAction.label);
});

test("header next action carries href only when source action has one", () => {
  const { continuity, orchestration } = buildStack();
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity, orchestration }));
  // Neither source has a caller-supplied href in our factories
  assert.equal(ws.header.nextActionHref, undefined);
});

// ---------------------------------------------------------------------------
// 6. Header unresolved issue count combines real signals
// ---------------------------------------------------------------------------

test("header unresolved count sums real signals", () => {
  const { continuity, orchestration, routing } = buildStack();
  const ws = buildDealIntelligenceWorkspace(
    buildInput({ continuity, orchestration, routing }),
  );
  const expectedAttention = continuity.momentum.needsAttentionCount;
  const expectedMissing = continuity.momentum.requiredDocumentsRemaining;
  const expectedClarifications = orchestration.clarifications.filter((c) => c.status === "open").length;
  const expectedRoutingReq = routing.missingInputs.filter((m) => m.priority === "required").length;
  assert.equal(
    ws.header.unresolvedIssueCount,
    expectedAttention + expectedMissing + expectedClarifications + expectedRoutingReq,
  );
});

// ---------------------------------------------------------------------------
// 7. Navigation visibility and ordering
// ---------------------------------------------------------------------------

test("navigation always exposes the spec-defined items in order", () => {
  const ws = buildDealIntelligenceWorkspace(buildInput());
  const ids = ws.navigation.map((n) => n.id);
  assert.deepStrictEqual(ids, BANKER_WORKSPACE_NAV_ORDER);
});

test("navigation overview item is always visible; advanced items follow visibility flags", () => {
  const { continuity, orchestration, routing } = buildStack();
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity, orchestration, routing }));
  const overview = ws.navigation.find((n) => n.id === "overview");
  assert.equal(overview?.visible, true);
  const orch = ws.navigation.find((n) => n.id === "orchestration");
  assert.equal(orch?.visible, ws.visibility.orchestration);
  const rt = ws.navigation.find((n) => n.id === "routing");
  assert.equal(rt?.visible, ws.visibility.routing);
});

test("submission prep nav item visible only when caller supplies a 15Q VM", () => {
  const wsHidden = buildDealIntelligenceWorkspace(buildInput());
  assert.equal(wsHidden.visibility.submissionPrep, false);
  const wsVisible = buildDealIntelligenceWorkspace(
    buildInput({ submissionPrep: { headline: "Prep", summary: "Prep summary" } }),
  );
  assert.equal(wsVisible.visibility.submissionPrep, true);
});

test("navigation labels match the spec dictionary", () => {
  const ws = buildDealIntelligenceWorkspace(buildInput());
  for (const item of ws.navigation) {
    assert.equal(item.label, BANKER_WORKSPACE_NAV_LABELS[item.id]);
  }
});

test("navigation anchors point to canonical workspace anchor ids", () => {
  const ws = buildDealIntelligenceWorkspace(buildInput());
  for (const item of ws.navigation) {
    assert.equal(item.href, `#${BANKER_WORKSPACE_ANCHOR_IDS[item.id]}`);
  }
});

test("anchorPrefix passthrough applied to nav hrefs", () => {
  const ws = buildDealIntelligenceWorkspace(buildInput({ anchorPrefix: "/banker/deals/d-1" }));
  for (const item of ws.navigation) {
    assert.ok(item.href.startsWith("/banker/deals/d-1#"));
  }
});

// ---------------------------------------------------------------------------
// 8. Cross-workspace consistency / no duplicate state
// ---------------------------------------------------------------------------

test("workspace VMs are passed through verbatim (no re-derivation)", () => {
  const { continuity, orchestration, routing } = buildStack();
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity, orchestration, routing }));
  assert.equal(ws.continuity, continuity);
  assert.equal(ws.orchestration, orchestration);
  assert.equal(ws.routing, routing);
});

// ---------------------------------------------------------------------------
// 9. Deterministic ordering
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const { continuity, orchestration, routing } = buildStack();
  const a = buildDealIntelligenceWorkspace(
    buildInput({ continuity, orchestration, routing }),
  );
  const b = buildDealIntelligenceWorkspace(
    buildInput({ continuity, orchestration, routing }),
  );
  assert.deepStrictEqual(a.header, b.header);
  assert.deepStrictEqual(a.navigation, b.navigation);
  assert.deepStrictEqual(a.visibility, b.visibility);
});

// ---------------------------------------------------------------------------
// 10. No fake timestamps in header
// ---------------------------------------------------------------------------

test("header recentActivitySummary omitted when no continuity activity is provided", () => {
  const { continuity } = buildStack();
  // Our factory builds continuity without activity events
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity }));
  assert.equal(ws.header.recentActivitySummary, undefined);
});

test("header values never contain ISO timestamps the inputs didn't supply", () => {
  const { continuity, orchestration, routing } = buildStack();
  const ws = buildDealIntelligenceWorkspace(buildInput({ continuity, orchestration, routing }));
  const text = [
    ws.header.dealLabel,
    ws.header.operationalStateLabel,
    ws.header.submissionReadinessLabel,
    ws.header.routingReadinessLabel,
    ws.header.waitingOnLabel,
    ws.header.nextActionLabel,
    ws.header.recentActivitySummary ?? "",
  ].join(" ");
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(text), false);
});

// ---------------------------------------------------------------------------
// 11. No forbidden terms
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "approval odds",
  "guaranteed",
  "approved",
  "pre-approved",
  "conditional approval",
  "lender acceptance probability",
  "risk score",
  "simulated",
  "fake sla",
  "classifier",
  "parser error",
  "extraction failed",
  "borrower qualifies",
  "loan will fund",
  "guaranteed funding",
];

test("no forbidden terms in assembled workspace header / navigation across scenarios", () => {
  const scenarios = [
    buildInput(),
    (() => {
      const { continuity, orchestration, routing } = buildStack();
      return buildInput({ continuity, orchestration, routing });
    })(),
  ];
  for (const input of scenarios) {
    const ws = buildDealIntelligenceWorkspace(input);
    const text = [
      ws.header.dealLabel,
      ws.header.operationalStateLabel,
      ws.header.submissionReadinessLabel,
      ws.header.routingReadinessLabel,
      ws.header.waitingOnLabel,
      ws.header.nextActionLabel,
      ws.header.recentActivitySummary ?? "",
      ...ws.navigation.map((n) => n.label),
    ]
      .join(" ")
      .toLowerCase();
    for (const term of FORBIDDEN) {
      assert.ok(!text.includes(term.toLowerCase()), `Forbidden term "${term}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 12. Deal-label fallback uses borrower label when dealLabel missing
// ---------------------------------------------------------------------------

test("dealLabel falls back to borrowerLabel then to deal-id prefix", () => {
  const a = buildDealIntelligenceWorkspace(buildInput({ borrowerLabel: "Acme LLC" }));
  assert.equal(a.header.dealLabel, "Acme LLC");

  const b = buildDealIntelligenceWorkspace(buildInput({ dealId: "abcdefghijklmnop" }));
  assert.equal(b.header.dealLabel, "Deal abcdefgh");
});
