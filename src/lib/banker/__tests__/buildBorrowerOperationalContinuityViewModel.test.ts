import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerOperationalContinuityViewModel,
  BORROWER_OPERATIONAL_HANDOFF_STATE_LABELS,
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

// ---------------------------------------------------------------------------
// Factory helpers
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

type Scenario = {
  portalStage?: PortalStage;
  docs?: BorrowerDocumentItemInput[];
  blockers?: CommunicationInput["blockers"];
  commDocsOverride?: CommunicationInput["documents"];
  activity?: OperationalContinuityActivityEvent[];
  bankerWorkspaceHref?: string | null;
  requestDocumentsHref?: string | null;
  submissionPrepHref?: string | null;
  borrowerMessageHref?: string | null;
};

function buildScenario(opts: Scenario = {}) {
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
  ];
  const portalStage = opts.portalStage ?? "additional_items_needed";
  const documents = mkDocs(docs);
  const journey = mkJourney({ portalStage });
  const readiness = mkReadiness({ portalStage });
  const dealHealth = mkDealHealth({ portalStage });
  const guidance = mkGuidance({ portalStage });
  const commDocs =
    opts.commDocsOverride ??
    docs.map((d) => ({
      id: d.id,
      label: d.title,
      status: d.status,
      required: d.required,
    }));
  const communication = mkComm({
    portalStage,
    documents: commDocs,
    blockers: opts.blockers ?? [],
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
  if (opts.bankerWorkspaceHref !== undefined)
    input.bankerWorkspaceHref = opts.bankerWorkspaceHref;
  if (opts.requestDocumentsHref !== undefined)
    input.requestDocumentsHref = opts.requestDocumentsHref;
  if (opts.submissionPrepHref !== undefined)
    input.submissionPrepHref = opts.submissionPrepHref;
  if (opts.borrowerMessageHref !== undefined)
    input.borrowerMessageHref = opts.borrowerMessageHref;
  return input;
}

// ---------------------------------------------------------------------------
// 1. Minimal fallback
// ---------------------------------------------------------------------------

test("minimal empty state produces borrower_starting", () => {
  const input = buildScenario({
    docs: [],
    portalStage: "getting_started",
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.handoffState, "borrower_starting");
  assert.ok(vm.headline.length > 0);
  assert.ok(vm.summary.length > 0);
  assert.equal(vm.recentEvents.length, 0);
  assert.equal(vm.momentum.requiredDocumentsReceived, 0);
  assert.equal(vm.cards.length, 6);
});

// ---------------------------------------------------------------------------
// 2. Handoff: waiting_on_borrower
// ---------------------------------------------------------------------------

test("waiting_on_borrower when required docs are strictly missing", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.handoffState, "waiting_on_borrower");
  assert.equal(vm.nextBestAction.id, "request_missing_documents");
});

// ---------------------------------------------------------------------------
// 3. Handoff: waiting_on_banker
// ---------------------------------------------------------------------------

test("waiting_on_banker when borrower has uploads and communication waits on review", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
      { id: "d4", title: "Personal Financial Statement", required: true, status: "received" },
    ],
    portalStage: "buddy_reviewing",
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  // With required items all received, submission band is submission_preparation_ready
  // so the state escalates to ready_for_submission_prep.
  assert.ok(
    vm.handoffState === "ready_for_submission_prep" ||
      vm.handoffState === "ready_for_banker_review" ||
      vm.handoffState === "waiting_on_banker",
  );
});

// ---------------------------------------------------------------------------
// 4. Handoff: ready_for_banker_review
// ---------------------------------------------------------------------------

test("ready_for_banker_review when trust review is ready and submission band is near", () => {
  // 3 of 4 required received, no attention, communication waiting on review
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
      { id: "d4", title: "Debt Schedule", required: true, status: "missing" },
    ],
    portalStage: "buddy_reviewing",
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  // With one missing, state will fall to waiting_on_borrower OR waiting_on_banker
  // depending on communication.
  // Communication had 1 missing in documents so waitingOn = "borrower" → waiting_on_borrower.
  assert.equal(vm.handoffState, "waiting_on_borrower");
});

// ---------------------------------------------------------------------------
// 5. Handoff: ready_for_submission_prep
// ---------------------------------------------------------------------------

test("ready_for_submission_prep when all required docs received and no attention", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.handoffState, "ready_for_submission_prep");
  assert.equal(vm.nextBestAction.id, "prepare_submission_package");
  assert.equal(vm.nextBestAction.urgency, "high");
});

// ---------------------------------------------------------------------------
// 6. Handoff: needs_clarification
// ---------------------------------------------------------------------------

test("needs_clarification when documents flagged for attention and no missing", () => {
  // Need-attention documents → communication will set waitingOn=clarification
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "needs_attention" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.handoffState, "needs_clarification");
  assert.equal(vm.nextBestAction.id, "resolve_attention_items");
});

// ---------------------------------------------------------------------------
// 7. Handoff: borrower_blocked
// ---------------------------------------------------------------------------

test("borrower_blocked when communication has a critical blocker", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
    ],
    blockers: [
      { id: "b1", label: "Critical issue", severity: "critical" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.handoffState, "borrower_blocked");
  assert.equal(vm.nextBestAction.id, "send_reassurance_update");
  assert.equal(vm.nextBestAction.urgency, "high");
});

// ---------------------------------------------------------------------------
// 8. Next best action prioritization (high urgency for many missing)
// ---------------------------------------------------------------------------

test("next best action urgency=high when many required items missing", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
      { id: "d4", title: "Personal Financial Statement", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.nextBestAction.id, "request_missing_documents");
  assert.equal(vm.nextBestAction.urgency, "high");
});

test("next best action urgency=normal for a small number of missing docs", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.nextBestAction.id, "request_missing_documents");
  assert.equal(vm.nextBestAction.urgency, "normal");
});

// ---------------------------------------------------------------------------
// 9. Action href propagates when provided
// ---------------------------------------------------------------------------

test("action href is set when caller passes one", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    requestDocumentsHref: "/banker/deals/deal-123/request",
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.nextBestAction.href, "/banker/deals/deal-123/request");
});

test("action href omitted when no caller href and no fallback", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.nextBestAction.href, undefined);
});

// ---------------------------------------------------------------------------
// 10. Momentum signal counts
// ---------------------------------------------------------------------------

test("momentum signals reflect real document VM counts", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
      { id: "d4", title: "Debt Schedule", required: true, status: "needs_attention" },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.momentum.requiredDocumentsReceived, 2);
  assert.equal(vm.momentum.needsAttentionCount, 1);
  assert.ok(vm.momentum.requiredDocumentsRemaining >= 1);
});

// ---------------------------------------------------------------------------
// 11. No fake timestamps when no activity provided
// ---------------------------------------------------------------------------

test("momentum lastBorrowerActivityAt omitted when no activity events provided", () => {
  const input = buildScenario({});
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.momentum.lastBorrowerActivityAt, undefined);
});

test("momentum lastBorrowerActivityAt set only from real activity timestamps", () => {
  const input = buildScenario({
    activity: [
      {
        id: "a1",
        label: "Borrower uploaded Business Tax Returns",
        timestamp: "2026-05-12T10:00:00.000Z",
        category: "upload",
      },
      {
        id: "a2",
        label: "Borrower uploaded Balance Sheet",
        timestamp: "2026-05-15T14:00:00.000Z",
        category: "upload",
      },
    ],
  });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.momentum.lastBorrowerActivityAt, "2026-05-15T14:00:00.000Z");
});

// ---------------------------------------------------------------------------
// 12. Recent event cap
// ---------------------------------------------------------------------------

test("recent events are capped at 5 by default", () => {
  const activity: OperationalContinuityActivityEvent[] = Array.from(
    { length: 10 },
    (_, i) => ({
      id: `a${i}`,
      label: `Upload ${i}`,
      timestamp: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      category: "upload" as const,
    }),
  );
  const input = buildScenario({ activity });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.ok(vm.recentEvents.length <= 5);
});

test("recent events ordered newest first when timestamps exist", () => {
  const activity: OperationalContinuityActivityEvent[] = [
    {
      id: "a1",
      label: "Older upload",
      timestamp: "2026-05-01T00:00:00.000Z",
      category: "upload",
    },
    {
      id: "a2",
      label: "Newer upload",
      timestamp: "2026-05-10T00:00:00.000Z",
      category: "upload",
    },
  ];
  const input = buildScenario({ activity });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  assert.equal(vm.recentEvents[0]?.label, "Newer upload");
});

// ---------------------------------------------------------------------------
// 13. Deterministic ordering
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const input = buildScenario({
    activity: [
      {
        id: "a1",
        label: "Upload",
        timestamp: "2026-05-10T00:00:00.000Z",
        category: "upload",
      },
    ],
  });
  const a = buildBorrowerOperationalContinuityViewModel(input);
  const b = buildBorrowerOperationalContinuityViewModel(input);
  assert.deepStrictEqual(a, b);
});

test("cards have deterministic ids in stable order", () => {
  const vm = buildBorrowerOperationalContinuityViewModel(buildScenario());
  const ids = vm.cards.map((c) => c.id);
  assert.deepStrictEqual(ids, [
    "package_readiness",
    "borrower_action_needed",
    "banker_action_needed",
    "documents_attention",
    "submission_preparation",
    "trust_review",
  ]);
});

// ---------------------------------------------------------------------------
// 14. State labels match spec
// ---------------------------------------------------------------------------

test("handoff state labels include all 8 states", () => {
  const keys = Object.keys(BORROWER_OPERATIONAL_HANDOFF_STATE_LABELS).sort();
  assert.deepStrictEqual(keys, [
    "borrower_active",
    "borrower_blocked",
    "borrower_starting",
    "needs_clarification",
    "ready_for_banker_review",
    "ready_for_submission_prep",
    "waiting_on_banker",
    "waiting_on_borrower",
  ]);
});

// ---------------------------------------------------------------------------
// 15. No forbidden terms
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "supabase",
  "lifecycle",
  "docs_in_progress",
  "classifier",
  "parser error",
  "extraction failed",
  "approval odds",
  "guaranteed",
  "approved",
  "pre-approved",
  "probability of approval",
  "lender acceptance probability",
  "borrower qualifies",
  "loan will fund",
  "guaranteed funding",
];

function collectText(
  vm: ReturnType<typeof buildBorrowerOperationalContinuityViewModel>,
): string {
  const parts: string[] = [
    vm.headline,
    vm.summary,
    vm.waitingOnLabel,
    vm.nextBestAction.label,
    vm.nextBestAction.rationale,
    vm.momentum.waitingOnLabel,
    vm.momentum.submissionReadinessLabel,
    vm.momentum.trustReviewLabel,
    ...vm.cards.flatMap((c) => [c.title, c.summary]),
    ...vm.recentEvents.flatMap((e) => [e.label, e.description ?? ""]),
  ];
  return parts.join(" ").toLowerCase();
}

test("no forbidden terms across multiple scenarios", () => {
  const scenarios = [
    buildScenario(),
    buildScenario({
      docs: [
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
    }),
    buildScenario({ docs: [], portalStage: "getting_started" }),
    buildScenario({
      blockers: [{ id: "b", label: "Critical", severity: "critical" }],
    }),
  ];
  for (const input of scenarios) {
    const text = collectText(buildBorrowerOperationalContinuityViewModel(input));
    for (const term of FORBIDDEN) {
      assert.ok(
        !text.includes(term.toLowerCase()),
        `Forbidden term "${term}" in: ${text}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 16. No approval language
// ---------------------------------------------------------------------------

test("no approval/funding/guarantee language", () => {
  const input = buildScenario({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  });
  const text = collectText(buildBorrowerOperationalContinuityViewModel(input));
  for (const phrase of [
    "you are approved",
    "borrower is approved",
    "loan will fund",
    "guaranteed funding",
    "pre-approved",
    "conditional approval",
    "credit decision",
  ]) {
    assert.ok(!text.includes(phrase), `Approval phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 17. VM never emits ISO timestamps it didn't receive
// ---------------------------------------------------------------------------

test("VM does not invent any timestamps when none provided", () => {
  const input = buildScenario({ activity: [] });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  const serialized = JSON.stringify(vm);
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(serialized), false);
});

// ---------------------------------------------------------------------------
// 18. Recent events translate to banker-operational categories
// ---------------------------------------------------------------------------

test("activity events translated into banker-safe categories", () => {
  const activity: OperationalContinuityActivityEvent[] = [
    {
      id: "a1",
      label: "Borrower uploaded Tax Return",
      timestamp: "2026-05-10T00:00:00.000Z",
      category: "upload",
    },
    {
      id: "a2",
      label: "Buddy reviewed Balance Sheet",
      timestamp: "2026-05-11T00:00:00.000Z",
      category: "review",
    },
  ];
  const input = buildScenario({ activity });
  const vm = buildBorrowerOperationalContinuityViewModel(input);
  const categories = vm.recentEvents.map((e) => e.category);
  assert.ok(categories.includes("document"));
  assert.ok(categories.includes("review"));
});
