import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBrokerageOwnerCommandCenterViewModel,
  BROKERAGE_PIPELINE_STATE_ORDER,
  BROKERAGE_BOTTLENECK_SEVERITY_LABELS,
  BROKERAGE_PIPELINE_STATE_LABELS,
  type BrokerageOwnerCommandCenterInput,
  type BrokerageDealRecord,
  type BrokerageTeamMember,
  type BrokerageActivityEvent,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import { buildBankerCommandCenterViewModel } from "@/lib/banker/buildBankerCommandCenterViewModel";
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
// Borrower stack builder (mirrors prior banker test factories)
// ---------------------------------------------------------------------------

type PortalStage = JourneyInput["portalStage"];

function buildStack(opts: {
  dealId: string;
  docs?: BorrowerDocumentItemInput[];
  portalStage?: PortalStage;
  blockers?: CommunicationInput["blockers"];
} = { dealId: "deal-1" }) {
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
    borrowerLabel?: string;
  } = { dealId: "deal-1" },
): BrokerageDealRecord {
  const stack = buildStack({ ...opts, dealId });
  const record: BrokerageDealRecord = {
    dealId,
    borrowerLabel: opts.borrowerLabel ?? `Acme ${dealId}`,
    continuity: stack.continuity,
    orchestration: stack.orchestration,
    routing: stack.routing,
  };
  if (opts.assignedTeamMemberId) record.assignedTeamMemberId = opts.assignedTeamMemberId;
  if (opts.lastActivityAt) record.lastActivityAt = opts.lastActivityAt;
  return record;
}

function makeInput(
  over: Partial<BrokerageOwnerCommandCenterInput> = {},
): BrokerageOwnerCommandCenterInput {
  return {
    deals: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Minimal fallback
// ---------------------------------------------------------------------------

test("minimal empty input produces safe fallback VM", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput());
  assert.equal(vm.pipeline.activeDeals, 0);
  assert.equal(vm.pipeline.bankerActionRequired, 0);
  assert.equal(vm.bottlenecks.length, 0);
  assert.equal(vm.workload.length, 0);
  assert.equal(vm.executiveAttention.length, 0);
  assert.equal(vm.activity.length, 0);
  assert.equal(vm.submissionPipeline.length, 5);
  assert.ok(vm.dailyBrief.length > 0);
  assert.ok(vm.headline.length > 0);
});

// ---------------------------------------------------------------------------
// 2. Pipeline summary counts
// ---------------------------------------------------------------------------

test("pipeline summary counts derive from supplied data only", () => {
  const deals: BrokerageDealRecord[] = [
    makeDeal("d-1", {
      dealId: "d-1",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "received" },
        { id: "y", title: "Balance Sheet", required: true, status: "received" },
      ],
    }),
    makeDeal("d-2", {
      dealId: "d-2",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "missing" },
      ],
    }),
  ];
  const vm = buildBrokerageOwnerCommandCenterViewModel(
    makeInput({ deals, submittedDeals: 0 }),
  );
  // No commandCenter supplied → activeDeals derives from deals.length
  assert.equal(vm.pipeline.activeDeals, 2);
  // submittedDeals=0 is supplied → present in summary
  assert.equal(vm.pipeline.submittedDeals, 0);
  // Pipeline state count includes preparing_package for the d-2 (1 received of 2 missing-required)
  const preparing = vm.submissionPipeline.find((s) => s.state === "preparing_package");
  assert.ok(preparing !== undefined);
});

// ---------------------------------------------------------------------------
// 3. Banker / borrower action counts come from the commandCenter when supplied
// ---------------------------------------------------------------------------

test("pipeline borrower/banker action counts are sourced from commandCenter", () => {
  const deals = [
    makeDeal("d-1", { dealId: "d-1" }),
    makeDeal("d-2", { dealId: "d-2" }),
  ];
  const commandCenter = buildBankerCommandCenterViewModel({
    deals: deals.map((d) => ({
      dealId: d.dealId,
      borrowerLabel: d.borrowerLabel,
      continuity: d.continuity!,
    })),
  });
  const vm = buildBrokerageOwnerCommandCenterViewModel(
    makeInput({ deals, commandCenter }),
  );
  assert.equal(vm.pipeline.borrowerActionRequired, commandCenter.summary.borrowerActionRequired);
  assert.equal(vm.pipeline.bankerActionRequired, commandCenter.summary.bankerActionRequired);
  assert.equal(vm.pipeline.stalledDeals, commandCenter.summary.stalledDeals);
});

// ---------------------------------------------------------------------------
// 4. Bottleneck derivation
// ---------------------------------------------------------------------------

test("bottlenecks emerge from real counts only", () => {
  const deals = [
    makeDeal("d-1", { dealId: "d-1" }),
    makeDeal("d-2", { dealId: "d-2" }),
    makeDeal("d-3", { dealId: "d-3" }),
  ];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  // Each deal has 1 required missing → missing-doc concentration emerges.
  const missing = vm.bottlenecks.find((b) => b.id === "missing_document_concentration");
  assert.ok(missing);
  assert.equal(missing.affectedDeals, 3);
});

test("bottlenecks empty when no real signals exist", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput());
  assert.equal(vm.bottlenecks.length, 0);
});

// ---------------------------------------------------------------------------
// 5. Severity derivation
// ---------------------------------------------------------------------------

test("bottleneck severity escalates with count thresholds", () => {
  // Build 16 missing-doc deals to trigger critical
  const deals = Array.from({ length: 16 }, (_, i) =>
    makeDeal(`d-${String(i).padStart(2, "0")}`, { dealId: `d-${String(i).padStart(2, "0")}` }),
  );
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  const missing = vm.bottlenecks.find((b) => b.id === "missing_document_concentration");
  assert.equal(missing?.severity, "critical");
});

// ---------------------------------------------------------------------------
// 6. Workload aggregation
// ---------------------------------------------------------------------------

test("workload aggregates per-banker counts from assigned deals", () => {
  const team: BrokerageTeamMember[] = [
    { id: "user-a", name: "Alice Banker", role: "banker" },
    { id: "user-b", name: "Bob Banker", role: "banker" },
  ];
  const deals = [
    makeDeal("d-1", { dealId: "d-1", assignedTeamMemberId: "user-a" }),
    makeDeal("d-2", { dealId: "d-2", assignedTeamMemberId: "user-a" }),
    makeDeal("d-3", { dealId: "d-3", assignedTeamMemberId: "user-b" }),
  ];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals, team }));
  const alice = vm.workload.find((w) => w.id === "user-a");
  const bob = vm.workload.find((w) => w.id === "user-b");
  assert.equal(alice?.activeDeals, 2);
  assert.equal(bob?.activeDeals, 1);
});

test("workload empty when no team members supplied", () => {
  const deals = [makeDeal("d-1", { dealId: "d-1", assignedTeamMemberId: "user-a" })];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  assert.equal(vm.workload.length, 0);
});

// ---------------------------------------------------------------------------
// 7. Executive attention prioritization
// ---------------------------------------------------------------------------

test("critical bottlenecks bubble up to executive attention", () => {
  const deals = Array.from({ length: 16 }, (_, i) =>
    makeDeal(`d-${String(i).padStart(2, "0")}`, { dealId: `d-${String(i).padStart(2, "0")}` }),
  );
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  const hasCritical = vm.executiveAttention.some((e) => e.severity === "critical");
  assert.ok(hasCritical);
});

test("banker overload surfaces as executive attention when active deals >= 8", () => {
  const team: BrokerageTeamMember[] = [
    { id: "user-a", name: "Alice Banker", role: "banker" },
  ];
  const deals = Array.from({ length: 9 }, (_, i) =>
    makeDeal(`d-${i}`, { dealId: `d-${i}`, assignedTeamMemberId: "user-a" }),
  );
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals, team }));
  const overload = vm.executiveAttention.find((e) => e.id.startsWith("overload_"));
  assert.ok(overload);
  assert.equal(overload.area, "banker");
});

test("unowned deals surface when no team member is assigned", () => {
  const deals = [makeDeal("d-1", { dealId: "d-1" })];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  const unowned = vm.executiveAttention.find((e) => e.id === "unowned_deals");
  assert.ok(unowned);
});

// ---------------------------------------------------------------------------
// 8. Submission pipeline counts
// ---------------------------------------------------------------------------

test("submission pipeline includes all five canonical states in order", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput());
  const states = vm.submissionPipeline.map((s) => s.state);
  assert.deepStrictEqual(states, BROKERAGE_PIPELINE_STATE_ORDER);
});

test("submission pipeline count reflects deals' orchestration states", () => {
  // Without banker-review persistence, all-required-received orchestration
  // lands in "package_review" (which is intentionally excluded from the
  // 5 operational pipeline states). Use the missing-required scenario which
  // unambiguously lands in "preparing_package".
  const deals = [
    makeDeal("d-1", {
      dealId: "d-1",
      docs: [
        { id: "x", title: "Business Tax Returns", required: true, status: "missing" },
        { id: "y", title: "Balance Sheet", required: true, status: "received" },
      ],
    }),
  ];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  const preparing = vm.submissionPipeline.find((s) => s.state === "preparing_package");
  assert.equal(preparing?.count, 1);
});

test("submission pipeline counts orchestration in ready_for_submission only when banker review is persisted", () => {
  const stack = buildStack({
    dealId: "d-ready",
    docs: [
      { id: "x", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "y", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  // Manually swap the orchestration's state to simulate persisted banker review
  // → state === "ready_for_submission".
  const orchestration = {
    ...stack.orchestration,
    state: "ready_for_submission" as const,
  };
  const deals: BrokerageDealRecord[] = [
    {
      dealId: "d-ready",
      borrowerLabel: "Acme",
      continuity: stack.continuity,
      orchestration,
      routing: stack.routing,
    },
  ];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  const ready = vm.submissionPipeline.find((s) => s.state === "ready_for_submission");
  assert.equal(ready?.count, 1);
});

// ---------------------------------------------------------------------------
// 9. Activity ordering and cap
// ---------------------------------------------------------------------------

test("activity is ordered newest-first by timestamp", () => {
  const activity: BrokerageActivityEvent[] = [
    { id: "a1", label: "Older", timestamp: "2026-05-10T00:00:00.000Z", category: "borrower" },
    { id: "a2", label: "Newer", timestamp: "2026-05-15T00:00:00.000Z", category: "submission" },
  ];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ activity }));
  assert.equal(vm.activity[0]?.label, "Newer");
  assert.equal(vm.activity[1]?.label, "Older");
});

test("activity respects cap (default 10)", () => {
  const activity: BrokerageActivityEvent[] = Array.from({ length: 14 }, (_, i) => ({
    id: `a${i}`,
    label: `Event ${i}`,
    timestamp: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    category: "borrower" as const,
  }));
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ activity }));
  assert.ok(vm.activity.length <= 10);
});

// ---------------------------------------------------------------------------
// 10. Deterministic ordering
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const deals = [makeDeal("d-1", { dealId: "d-1" }), makeDeal("d-2", { dealId: "d-2" })];
  const a = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  const b = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  assert.deepStrictEqual(a, b);
});

test("input deal ordering does not affect output", () => {
  const a = buildBrokerageOwnerCommandCenterViewModel(
    makeInput({ deals: [makeDeal("d-1", { dealId: "d-1" }), makeDeal("d-2", { dealId: "d-2" })] }),
  );
  const b = buildBrokerageOwnerCommandCenterViewModel(
    makeInput({ deals: [makeDeal("d-2", { dealId: "d-2" }), makeDeal("d-1", { dealId: "d-1" })] }),
  );
  assert.deepStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// 11. No fake timestamps
// ---------------------------------------------------------------------------

test("activity events without timestamps stay timestamp-free", () => {
  const activity: BrokerageActivityEvent[] = [
    { id: "a1", label: "No-timestamp event", category: "operations" },
  ];
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ activity }));
  assert.equal(vm.activity[0]?.timestamp, undefined);
});

test("staleness derivation requires evaluatedAt", () => {
  const deals = [
    makeDeal("d-old", {
      dealId: "d-old",
      lastActivityAt: "2026-04-01T00:00:00.000Z",
    }),
  ];
  const noEval = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals }));
  const inactiveNoEval = noEval.bottlenecks.find(
    (b) => b.id === "borrower_no_activity",
  );
  assert.equal(inactiveNoEval, undefined);

  const evaluated = buildBrokerageOwnerCommandCenterViewModel(
    makeInput({ deals, evaluatedAt: "2026-05-20T00:00:00.000Z" }),
  );
  const inactiveEval = evaluated.bottlenecks.find(
    (b) => b.id === "borrower_no_activity",
  );
  assert.ok(inactiveEval);
});

// ---------------------------------------------------------------------------
// 12. Submitted / funded counts only emitted when caller supplies them
// ---------------------------------------------------------------------------

test("submittedDeals / fundedDeals omitted when caller does not provide", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput());
  assert.equal(vm.pipeline.submittedDeals, undefined);
  assert.equal(vm.pipeline.fundedDeals, undefined);
});

test("submittedDeals / fundedDeals echoed verbatim when supplied", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(
    makeInput({ submittedDeals: 3, fundedDeals: 1 }),
  );
  assert.equal(vm.pipeline.submittedDeals, 3);
  assert.equal(vm.pipeline.fundedDeals, 1);
});

// ---------------------------------------------------------------------------
// 13. Daily brief content
// ---------------------------------------------------------------------------

test("daily brief includes a banker-action bullet when banker action exists", () => {
  const deals = [
    makeDeal("d-1", { dealId: "d-1" }),
    makeDeal("d-2", { dealId: "d-2" }),
  ];
  const commandCenter = buildBankerCommandCenterViewModel({
    deals: deals.map((d) => ({
      dealId: d.dealId,
      borrowerLabel: d.borrowerLabel,
      continuity: d.continuity!,
    })),
  });
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput({ deals, commandCenter }));
  if (commandCenter.summary.bankerActionRequired > 0) {
    assert.ok(
      vm.dailyBrief.some((b) => b.toLowerCase().includes("banker review")),
    );
  }
});

test("daily brief is calm-fallback when nothing notable surfaces", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput());
  assert.ok(
    vm.dailyBrief.some((b) =>
      b.toLowerCase().includes("no major operational issues"),
    ),
  );
});

// ---------------------------------------------------------------------------
// 14. Label dictionaries are complete
// ---------------------------------------------------------------------------

test("severity and pipeline-state label dictionaries are complete", () => {
  assert.deepStrictEqual(
    Object.keys(BROKERAGE_BOTTLENECK_SEVERITY_LABELS).sort(),
    ["critical", "elevated", "low", "moderate"],
  );
  assert.deepStrictEqual(
    Object.keys(BROKERAGE_PIPELINE_STATE_LABELS).sort(),
    [
      "awaiting_clarifications",
      "preparing_package",
      "ready_for_submission",
      "submission_in_progress",
      "submitted",
    ],
  );
});

// ---------------------------------------------------------------------------
// 15. No forbidden terms
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "approval odds",
  "risk score",
  "guaranteed",
  "pre-approved",
  "probability of approval",
  "lender acceptance probability",
  "simulated",
  "fake sla",
  "classifier",
  "parser error",
  "extraction failed",
  "borrower qualifies",
  "loan will fund",
  "guaranteed funding",
];

function collectText(
  vm: ReturnType<typeof buildBrokerageOwnerCommandCenterViewModel>,
): string {
  return [
    vm.headline,
    vm.summary,
    ...vm.bottlenecks.flatMap((b) => [b.label, b.description]),
    ...vm.workload.flatMap((w) => [w.name, w.role]),
    ...vm.executiveAttention.flatMap((e) => [e.label, e.reason]),
    ...vm.activity.flatMap((a) => [a.label]),
    ...vm.dailyBrief,
  ]
    .join(" ")
    .toLowerCase();
}

test("no forbidden terms across scenarios", () => {
  const scenarios = [
    makeInput(),
    makeInput({
      deals: [makeDeal("d-1", { dealId: "d-1" })],
    }),
    makeInput({
      deals: Array.from({ length: 16 }, (_, i) =>
        makeDeal(`d-${i}`, { dealId: `d-${i}` }),
      ),
    }),
  ];
  for (const input of scenarios) {
    const text = collectText(buildBrokerageOwnerCommandCenterViewModel(input));
    for (const term of FORBIDDEN) {
      assert.ok(!text.includes(term.toLowerCase()), `Forbidden term "${term}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 16. No approval / forecasting language
// ---------------------------------------------------------------------------

test("no approval / funding / forecasting phrases in VM output", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(
    makeInput({
      deals: [makeDeal("d-1", { dealId: "d-1" })],
    }),
  );
  const text = collectText(vm);
  for (const phrase of [
    "you are approved",
    "borrower is approved",
    "loan will fund",
    "guaranteed funding",
    "pre-approved",
    "conditional approval",
    "credit decision",
    "revenue forecast",
    "expected revenue",
    "approval probability",
    "approval score",
  ]) {
    assert.ok(!text.includes(phrase), `Approval/forecasting phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 17. VM never emits ISO timestamps it didn't receive
// ---------------------------------------------------------------------------

test("VM emits no synthetic ISO timestamps", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(makeInput());
  const json = JSON.stringify(vm);
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(json), false);
});
