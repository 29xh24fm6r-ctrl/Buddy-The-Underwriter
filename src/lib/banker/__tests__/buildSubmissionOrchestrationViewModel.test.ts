import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSubmissionOrchestrationViewModel,
  SUBMISSION_ORCHESTRATION_STATE_LABELS,
  type SubmissionOrchestrationInput,
  type PersistedBankerReviewState,
  type PersistedSubmissionState,
  type SubmissionOrchestrationActivityEvent,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PortalStage = JourneyInput["portalStage"];

function buildBorrowerStack(opts: {
  dealId?: string;
  docs?: BorrowerDocumentItemInput[];
  portalStage?: PortalStage;
  blockers?: CommunicationInput["blockers"];
  commDocsOverride?: CommunicationInput["documents"];
} = {}) {
  const dealId = opts.dealId ?? "deal-1";
  const docs = opts.docs ?? [
    { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
    { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
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
    documents:
      opts.commDocsOverride ??
      docs.map((d) => ({
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
  return { documents, communication, submission, trustReview, continuity };
}

function buildInput(opts: Parameters<typeof buildBorrowerStack>[0] & {
  bankerReview?: PersistedBankerReviewState;
  submissionState?: PersistedSubmissionState;
  activity?: SubmissionOrchestrationActivityEvent[];
  prepareSubmissionHref?: string;
  reviewPackageHref?: string;
  resolveClarificationsHref?: string;
  requestDocumentsHref?: string;
} = {}): SubmissionOrchestrationInput {
  const stack = buildBorrowerStack(opts);
  const input: SubmissionOrchestrationInput = {
    dealId: opts.dealId ?? "deal-1",
    ...stack,
  };
  if (opts.bankerReview) input.bankerReview = opts.bankerReview;
  if (opts.submissionState) input.submissionState = opts.submissionState;
  if (opts.activity) input.activity = opts.activity;
  if (opts.prepareSubmissionHref) input.prepareSubmissionHref = opts.prepareSubmissionHref;
  if (opts.reviewPackageHref) input.reviewPackageHref = opts.reviewPackageHref;
  if (opts.resolveClarificationsHref)
    input.resolveClarificationsHref = opts.resolveClarificationsHref;
  if (opts.requestDocumentsHref) input.requestDocumentsHref = opts.requestDocumentsHref;
  return input;
}

// ---------------------------------------------------------------------------
// 1. Minimal fallback
// ---------------------------------------------------------------------------

test("minimal empty input produces not_started state", () => {
  const input = buildInput({ docs: [], portalStage: "getting_started" });
  const vm = buildSubmissionOrchestrationViewModel(input);
  assert.equal(vm.state, "not_started");
  assert.equal(vm.gates.length, 7);
  assert.equal(vm.packageSections.length, 7);
  assert.equal(vm.timeline.length, 0);
});

// ---------------------------------------------------------------------------
// 2. State derivation matrix
// ---------------------------------------------------------------------------

test("preparing_package when some received but required still missing", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  }));
  assert.equal(vm.state, "preparing_package");
});

test("awaiting_clarifications when needs_attention items exist", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "needs_attention" },
    ],
  }));
  assert.equal(vm.state, "awaiting_clarifications");
});

test("package_review when blocking docs in but banker review not yet complete", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
  }));
  // Banker submission review is needs_review (no persistence) → package_review
  assert.equal(vm.state, "package_review");
});

test("ready_for_submission when all blocking gates passed including banker review", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    bankerReview: {
      packageInventoryReviewedAt: "2026-05-19T10:00:00.000Z",
      submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z",
    },
  }));
  assert.equal(vm.state, "ready_for_submission");
});

test("submission_in_progress when submissionStartedAt is set but not yet submitted", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
    submissionState: { submissionStartedAt: "2026-05-20T10:00:00.000Z" },
  }));
  assert.equal(vm.state, "submission_in_progress");
});

test("submitted only when persisted submittedAt exists — never fabricated", () => {
  const vmNo = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
    bankerReview: {
      packageInventoryReviewedAt: "2026-05-19T10:00:00.000Z",
      submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z",
    },
  }));
  // Even with banker review complete, VM must NOT claim submitted without persisted evidence.
  assert.notEqual(vmNo.state, "submitted");

  const vmYes = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
    submissionState: { submittedAt: "2026-05-21T10:00:00.000Z" },
  }));
  assert.equal(vmYes.state, "submitted");
});

// ---------------------------------------------------------------------------
// 3. Gate derivation
// ---------------------------------------------------------------------------

test("required_documents_received gate passes when nothing missing", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
    ],
  }));
  const gate = vm.gates.find((g) => g.id === "required_documents_received");
  assert.equal(gate?.status, "passed");
});

test("required_documents_received gate is blocked when items are missing", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput());
  const gate = vm.gates.find((g) => g.id === "required_documents_received");
  assert.equal(gate?.status, "blocked");
  assert.equal(gate?.blocking, true);
});

test("banker_submission_review_complete defaults to needs_review without persistence", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput());
  const gate = vm.gates.find((g) => g.id === "banker_submission_review_complete");
  assert.equal(gate?.status, "needs_review");
  // Confirm we don't fake passed when persistence is absent.
  assert.notEqual(gate?.status, "passed");
});

test("banker_submission_review_complete passes when persisted timestamp exists", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    bankerReview: { submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z" },
  }));
  const gate = vm.gates.find((g) => g.id === "banker_submission_review_complete");
  assert.equal(gate?.status, "passed");
});

test("required_sba_forms_received marks not_applicable when no SBA form requirements exist", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
    ],
  }));
  const gate = vm.gates.find((g) => g.id === "required_sba_forms_received");
  assert.equal(gate?.status, "not_applicable");
});

// ---------------------------------------------------------------------------
// 4. Package section assembly
// ---------------------------------------------------------------------------

test("package sections all 7 spec-defined ids present", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput());
  const ids = vm.packageSections.map((s) => s.id);
  assert.deepStrictEqual(ids, [
    "financial_package",
    "sba_forms",
    "ownership_identity",
    "business_verification",
    "supporting_documents",
    "clarification_notes",
    "banker_review_notes",
  ]);
});

test("financial_package counts derive from documents groups", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
    ],
  }));
  const section = vm.packageSections.find((s) => s.id === "financial_package");
  assert.ok(section);
  // 1 included, 1 missing
  assert.equal(section.includedCount, 1);
  assert.equal(section.missingCount, 1);
  assert.equal(section.status, "partial");
});

test("banker_review_notes section is unavailable without persisted notes", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput());
  const section = vm.packageSections.find((s) => s.id === "banker_review_notes");
  assert.equal(section?.status, "unavailable");
  assert.equal(section?.includedCount, 0);
});

test("banker_review_notes section reflects persisted banker notes when present", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    bankerReview: { reviewNotes: "Reviewed package — clean. Move to submission prep." },
  }));
  const section = vm.packageSections.find((s) => s.id === "banker_review_notes");
  assert.equal(section?.status, "complete");
  assert.equal(section?.includedCount, 1);
});

// ---------------------------------------------------------------------------
// 5. Clarification prioritization
// ---------------------------------------------------------------------------

test("clarifications include needs_attention documents and prioritize required first", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "needs_attention" },
    ],
  }));
  assert.ok(vm.clarifications.length >= 1);
  // Required-priority items must come before helpful/optional ones.
  for (let i = 0; i < vm.clarifications.length - 1; i++) {
    const order = { required: 0, helpful: 1, optional: 2 };
    const a = order[vm.clarifications[i].priority];
    const b = order[vm.clarifications[i + 1].priority];
    assert.ok(a <= b);
  }
});

test("clarifications never default to resolved without persistence", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "needs_attention" },
    ],
  }));
  for (const c of vm.clarifications) {
    assert.notEqual(c.status, "resolved");
  }
});

// ---------------------------------------------------------------------------
// 6. Next action derivation
// ---------------------------------------------------------------------------

test("next action = prepare_lender_submission when ready_for_submission", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    bankerReview: {
      packageInventoryReviewedAt: "2026-05-19T10:00:00.000Z",
      submissionReviewCompletedAt: "2026-05-20T10:00:00.000Z",
    },
    prepareSubmissionHref: "/banker/deals/deal-1/submit",
  }));
  assert.equal(vm.nextAction.id, "prepare_lender_submission");
  assert.equal(vm.nextAction.urgency, "high");
  assert.equal(vm.nextAction.href, "/banker/deals/deal-1/submit");
});

test("next action = request_missing_items when missing required docs", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
    ],
    requestDocumentsHref: "/banker/deals/deal-1/request",
  }));
  assert.equal(vm.nextAction.id, "request_missing_items");
  assert.equal(vm.nextAction.href, "/banker/deals/deal-1/request");
});

test("next action = resolve_clarifications when state is awaiting_clarifications", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
      { id: "d2", title: "Balance Sheet", required: true, status: "needs_attention" },
    ],
    resolveClarificationsHref: "/banker/deals/deal-1/clarify",
  }));
  assert.equal(vm.nextAction.id, "resolve_clarifications");
  assert.equal(vm.nextAction.href, "/banker/deals/deal-1/clarify");
});

test("next action href omitted when caller provides none", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput());
  assert.equal(vm.nextAction.href, undefined);
});

test("next action = no_action_available when submitted", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    submissionState: { submittedAt: "2026-05-20T10:00:00.000Z" },
  }));
  assert.equal(vm.nextAction.id, "no_action_available");
});

// ---------------------------------------------------------------------------
// 7. Timeline ordering & no-invention
// ---------------------------------------------------------------------------

test("timeline newest first when real timestamps exist", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    activity: [
      { id: "a1", label: "Borrower uploaded Tax Return", timestamp: "2026-05-10T00:00:00.000Z", category: "borrower_action" },
      { id: "a2", label: "Banker opened review", timestamp: "2026-05-15T00:00:00.000Z", category: "banker_review" },
    ],
  }));
  assert.equal(vm.timeline[0]?.label, "Banker opened review");
});

test("timeline does not synthesize a timestamp when none provided", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    activity: [
      { id: "a1", label: "Note without timestamp", category: "banker_review" },
    ],
  }));
  const event = vm.timeline.find((e) => e.label === "Note without timestamp");
  assert.equal(event?.timestamp, undefined);
});

test("timeline respects cap (default 6)", () => {
  const activity: SubmissionOrchestrationActivityEvent[] = Array.from({ length: 12 }, (_, i) => ({
    id: `a${i}`,
    label: `Event ${i}`,
    timestamp: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    category: "borrower_action",
  }));
  const vm = buildSubmissionOrchestrationViewModel(buildInput({ activity }));
  assert.ok(vm.timeline.length <= 6);
});

// ---------------------------------------------------------------------------
// 8. Determinism
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const a = buildSubmissionOrchestrationViewModel(buildInput());
  const b = buildSubmissionOrchestrationViewModel(buildInput());
  assert.deepStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// 9. No fake timestamps anywhere
// ---------------------------------------------------------------------------

test("VM emits no ISO timestamps when input provided none", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput());
  const json = JSON.stringify(vm);
  const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert.equal(isoLike.test(json), false);
});

// ---------------------------------------------------------------------------
// 10. State labels complete
// ---------------------------------------------------------------------------

test("state label dictionary covers all 7 states", () => {
  assert.deepStrictEqual(Object.keys(SUBMISSION_ORCHESTRATION_STATE_LABELS).sort(), [
    "awaiting_clarifications",
    "not_started",
    "package_review",
    "preparing_package",
    "ready_for_submission",
    "submission_in_progress",
    "submitted",
  ]);
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
  "probability of approval",
  "lender acceptance probability",
  "risk score",
  "fake sla",
  "simulated",
  "classifier",
  "extraction failed",
  "parser error",
  "borrower qualifies",
  "loan will fund",
  "guaranteed funding",
];

function collectText(
  vm: ReturnType<typeof buildSubmissionOrchestrationViewModel>,
): string {
  const parts: string[] = [
    vm.headline,
    vm.summary,
    vm.nextAction.label,
    vm.nextAction.rationale,
    ...vm.gates.flatMap((g) => [g.label, g.explanation]),
    ...vm.packageSections.flatMap((s) => [s.label, ...s.items.map((i) => i.label)]),
    ...vm.clarifications.flatMap((c) => [c.label, c.reason]),
    ...vm.timeline.flatMap((e) => [e.label]),
  ];
  return parts.join(" ").toLowerCase();
}

test("no forbidden terms across orchestration scenarios", () => {
  const scenarios = [
    buildInput(),
    buildInput({
      docs: [
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      ],
      bankerReview: { submissionReviewCompletedAt: "2026-05-20T00:00:00.000Z" },
    }),
    buildInput({ submissionState: { submittedAt: "2026-05-20T00:00:00.000Z" } }),
  ];
  for (const input of scenarios) {
    const text = collectText(buildSubmissionOrchestrationViewModel(input));
    for (const term of FORBIDDEN) {
      assert.ok(!text.includes(term.toLowerCase()), `Forbidden term "${term}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 12. No approval language
// ---------------------------------------------------------------------------

test("no approval/funding/guarantee language", () => {
  const vm = buildSubmissionOrchestrationViewModel(buildInput({
    docs: [
      { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
    ],
    bankerReview: { submissionReviewCompletedAt: "2026-05-20T00:00:00.000Z" },
  }));
  const text = collectText(vm);
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
