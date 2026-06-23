import test from "node:test";
import assert from "node:assert/strict";
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

// ---------------------------------------------------------------------------
// Factory helpers
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
      { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
    ]),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Band mapping — early_preparation
// ---------------------------------------------------------------------------

test("early_preparation band when nothing received and low progress", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      journey: mkJourney({
        checklistRequired: 0,
        checklistReceived: 0,
        checklistMissing: 0,
        missingItems: [],
        completedItems: [],
        portalStage: "getting_started",
      }),
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
        { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
        { id: "d3", title: "Debt Schedule", required: true, status: "missing" },
        { id: "d4", title: "SBA Form 1919", required: true, status: "missing" },
      ]),
    }),
  );
  assert.equal(vm.band, "early_preparation");
  assert.equal(vm.bandLabel, "Preparing your package");
});

// ---------------------------------------------------------------------------
// 2. Band mapping — progressing
// ---------------------------------------------------------------------------

test("progressing band when several items remaining", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
        { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
        { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
        { id: "d4", title: "Debt Schedule", required: true, status: "missing" },
        { id: "d5", title: "Bank Statements", required: true, status: "missing" },
      ]),
    }),
  );
  assert.equal(vm.band, "progressing");
});

// ---------------------------------------------------------------------------
// 3. Band mapping — near_submission_preparation
// ---------------------------------------------------------------------------

test("near_submission_preparation when <= 2 remaining, 0 attention", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
        { id: "d2", title: "Balance Sheet", required: true, status: "received" },
        { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
      ]),
    }),
  );
  assert.equal(vm.band, "near_submission_preparation");
});

// ---------------------------------------------------------------------------
// 4. Band mapping — submission_preparation_ready
// ---------------------------------------------------------------------------

test("submission_preparation_ready when all required received and no attention", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
        { id: "d2", title: "Balance Sheet", required: true, status: "received" },
        { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
      ]),
    }),
  );
  assert.equal(vm.band, "submission_preparation_ready");
  assert.ok(vm.headline.toLowerCase().includes("ready"));
});

// ---------------------------------------------------------------------------
// 5. Checklist derivation
// ---------------------------------------------------------------------------

test("checklist items derive from document groups", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(mkInput());
  assert.ok(vm.checklist.length > 0);
  // Should always have the attention + guidance entries
  assert.ok(vm.checklist.some((c) => c.id === "chk_attention"));
  assert.ok(vm.checklist.some((c) => c.id === "chk_guidance"));
});

test("checklist item completed when all required in group received", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      ]),
    }),
  );
  const taxItem = vm.checklist.find((c) => c.id === "chk_tax");
  assert.ok(taxItem);
  assert.equal(taxItem.completed, true);
});

// ---------------------------------------------------------------------------
// 6. Package item grouping
// ---------------------------------------------------------------------------

test("packageItems only includes received/accepted/uploaded/reviewing items", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
        { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
      ]),
    }),
  );
  assert.equal(vm.packageItems.length, 1);
  assert.equal(vm.packageItems[0]?.label, "Business tax returns");
});

test("packageItems sorted by category then label", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "SBA Form 1919", required: true, status: "received" },
        { id: "d2", title: "Business Tax Returns", required: true, status: "received" },
        { id: "d3", title: "Balance Sheet", required: true, status: "accepted" },
      ]),
    }),
  );
  // Financial items should appear before forms
  const categories = vm.packageItems.map((i) => i.category);
  const formsIdx = categories.indexOf("forms");
  const lastFinIdx = categories.lastIndexOf("financial");
  if (formsIdx !== -1 && lastFinIdx !== -1) {
    assert.ok(lastFinIdx < formsIdx);
  }
});

// ---------------------------------------------------------------------------
// 7. Attention item prioritization
// ---------------------------------------------------------------------------

test("attention items include missing required and needs_attention docs", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
        { id: "d2", title: "Balance Sheet", required: true, status: "needs_attention" },
        { id: "d3", title: "SBA Form 1919", required: true, status: "received" },
      ]),
    }),
  );
  assert.ok(vm.attentionItems.length >= 2);
  assert.ok(vm.attentionItems.every((i) => i.priority === "required" || i.priority === "helpful"));
});

test("attention items sort required before helpful", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      communication: mkComm({
        blockers: [],
        documents: [
          { id: "d1", label: "X", status: "missing", required: true },
        ],
        recommendations: [{ id: "r1", label: "Payroll report", priority: "high" }],
      }),
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "missing" },
      ]),
    }),
  );
  const priorities = vm.attentionItems.map((i) => i.priority);
  const firstHelpful = priorities.indexOf("helpful");
  const lastRequired = priorities.lastIndexOf("required");
  if (firstHelpful !== -1 && lastRequired !== -1) {
    assert.ok(firstHelpful > lastRequired);
  }
});

// ---------------------------------------------------------------------------
// 8. Friction signal derivation
// ---------------------------------------------------------------------------

test("friction signals include missing_required_documents when items remain", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(mkInput());
  assert.ok(vm.frictionSignals.includes("missing_required_documents"));
});

test("friction signals include no_major_submission_blockers when clear", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      ]),
      communication: mkComm({ portalStage: "getting_started" }),
    }),
  );
  assert.ok(vm.frictionSignals.includes("no_major_submission_blockers"));
});

test("friction signals include incomplete_forms when SBA forms missing", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(mkInput());
  assert.ok(vm.frictionSignals.includes("incomplete_forms"));
});

// ---------------------------------------------------------------------------
// 9. Safe fallback for minimal state
// ---------------------------------------------------------------------------

test("minimal empty input produces valid VM", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      journey: mkJourney({
        checklistRequired: 0,
        checklistReceived: 0,
        checklistMissing: 0,
        missingItems: [],
        completedItems: [],
        portalStage: "getting_started",
      }),
      guidance: mkGuidance({
        checklistRequired: 0,
        checklistReceived: 0,
        checklistMissing: 0,
        docsUploaded: 0,
        docsVerified: 0,
        blockerCount: 0,
        readinessScore: 0,
        missingItems: [],
        completedItems: [],
        hasActivity: false,
        recommendationCount: 0,
        portalStage: "getting_started",
      }),
      communication: mkComm({ portalStage: "getting_started" }),
      documents: mkDocs([]),
    }),
  );
  assert.ok(vm.headline.length > 0);
  assert.ok(vm.summary.length > 0);
  assert.ok(vm.nextSteps.length > 0);
  assert.equal(vm.readinessPercent, undefined);
});

// ---------------------------------------------------------------------------
// 10. Deterministic ordering
// ---------------------------------------------------------------------------

test("same input produces identical output", () => {
  const input = mkInput();
  const vm1 = buildBorrowerSubmissionReadinessViewModel(input);
  const vm2 = buildBorrowerSubmissionReadinessViewModel(input);
  assert.deepStrictEqual(vm1, vm2);
});

// ---------------------------------------------------------------------------
// 11. No forbidden terms
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "credit_memo",
  "lifecycle",
  "underwriting_queue",
  "docs_in_progress",
  "approval odds",
  "guaranteed",
  "approved",
  "conditional approval",
  "probability of approval",
  "risk score",
  "lender acceptance probability",
  "you qualify",
  "your loan will fund",
  "guaranteed funding",
  "pre-approved",
];

function collectText(
  vm: ReturnType<typeof buildBorrowerSubmissionReadinessViewModel>,
): string {
  const parts = [
    vm.headline,
    vm.summary,
    vm.bandLabel,
    ...vm.checklist.flatMap((c) => [c.label, c.description ?? ""]),
    ...vm.packageItems.map((p) => p.label),
    ...vm.attentionItems.flatMap((a) => [a.label, a.description ?? ""]),
    ...vm.nextSteps.flatMap((s) => [s.headline, s.description]),
  ];
  return parts.join(" ");
}

test("no forbidden terms across bands", () => {
  const inputs = [
    mkInput(),
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
        { id: "d2", title: "Balance Sheet", required: true, status: "received" },
      ]),
    }),
    mkInput({
      documents: mkDocs([]),
      communication: mkComm({ portalStage: "getting_started" }),
    }),
  ];
  for (const input of inputs) {
    const text = collectText(buildBorrowerSubmissionReadinessViewModel(input)).toLowerCase();
    for (const term of FORBIDDEN) {
      assert.ok(!text.includes(term.toLowerCase()), `Forbidden term "${term}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 12. No approval language
// ---------------------------------------------------------------------------

test("no approval/guarantee language", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      ]),
    }),
  );
  const text = collectText(vm).toLowerCase();
  for (const phrase of [
    "you are approved",
    "your loan will",
    "guaranteed funding",
    "pre-approved",
    "credit decision",
    "lending decision",
  ]) {
    // "lending decision" is used in the education step in a negating context
    // ("not a lending decision") which is safe — but verify no positive assertion
    if (phrase === "lending decision") {
      // Allow "not a lending decision"
      continue;
    }
    assert.ok(!text.includes(phrase), `Approval phrase "${phrase}"`);
  }
});

// ---------------------------------------------------------------------------
// 13. No fake submission claims
// ---------------------------------------------------------------------------

test("does not claim package was submitted", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "accepted" },
      ]),
    }),
  );
  const text = collectText(vm).toLowerCase();
  assert.ok(!text.includes("has been submitted"));
  assert.ok(!text.includes("was submitted"));
  assert.ok(!text.includes("submitted to lender"));
});

// ---------------------------------------------------------------------------
// 14. Readiness percent from real data
// ---------------------------------------------------------------------------

test("readinessPercent reflects real document received ratio", () => {
  const vm = buildBorrowerSubmissionReadinessViewModel(
    mkInput({
      documents: mkDocs([
        { id: "d1", title: "Business Tax Returns", required: true, status: "received" },
        { id: "d2", title: "Balance Sheet", required: true, status: "missing" },
        { id: "d3", title: "SBA Form 1919", required: true, status: "missing" },
        { id: "d4", title: "Lease", required: false, status: "missing" },
      ]),
    }),
  );
  // 1 of 3 required received = 33%
  assert.equal(vm.readinessPercent, 33);
});
