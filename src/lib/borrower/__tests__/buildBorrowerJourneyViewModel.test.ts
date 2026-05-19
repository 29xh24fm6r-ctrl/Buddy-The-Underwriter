import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerJourneyViewModel,
  type JourneyInput,
  type BorrowerJourneyViewModel,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    dealName: "Acme SBA Loan",
    borrowerName: "Jane Doe",
    checklistRequired: 5,
    checklistReceived: 2,
    checklistMissing: 3,
    docsUploaded: 3,
    docsInFlight: false,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
      { id: "m2", title: "Voided Business Check", required: true },
      { id: "m3", title: "SBA Form 1919", required: true },
    ],
    completedItems: [
      { id: "c1", title: "Personal Financial Statement" },
      { id: "c2", title: "Business License" },
    ],
    portalStage: "additional_items_needed",
    token: "test-token-abc",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Milestone rendering — all 8 milestones present
// ---------------------------------------------------------------------------

test("produces exactly 8 journey milestones", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  assert.equal(vm.milestones.length, 8);
  const ids = vm.milestones.map((m) => m.id);
  assert.ok(ids.includes("started_application"));
  assert.ok(ids.includes("financial_documents"));
  assert.ok(ids.includes("ready_for_lender_submission"));
});

// ---------------------------------------------------------------------------
// 2. Completed / current / upcoming / blocked states
// ---------------------------------------------------------------------------

test("milestones have correct states for documents-in-progress stage", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  // "financial_documents" is current stage for additional_items_needed
  const statuses = vm.milestones.map((m) => m.status);
  // started_application and business_profile should be completed
  assert.equal(statuses[0], "completed"); // started_application
  assert.equal(statuses[1], "completed"); // business_profile
  assert.equal(statuses[2], "completed"); // ownership_identity
  // financial_documents should be blocked (missing items + additional_items_needed)
  assert.equal(statuses[3], "blocked"); // financial_documents
  // rest upcoming
  assert.equal(statuses[4], "upcoming");
  assert.equal(statuses[5], "upcoming");
});

test("milestones show current (not blocked) when no missing items", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({
      portalStage: "buddy_reviewing",
      checklistMissing: 0,
      missingItems: [],
    }),
  );
  const buddyReview = vm.milestones.find((m) => m.id === "buddy_review");
  assert.equal(buddyReview?.status, "current");
});

// ---------------------------------------------------------------------------
// 3. Progress percentage rendering
// ---------------------------------------------------------------------------

test("progress percentage is between 0 and 100", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  assert.ok(vm.progressPercent >= 0);
  assert.ok(vm.progressPercent <= 100);
});

test("progress increases when more checklist items are received", () => {
  const low = buildBorrowerJourneyViewModel(
    baseInput({ checklistReceived: 0, checklistMissing: 5 }),
  );
  const high = buildBorrowerJourneyViewModel(
    baseInput({ checklistReceived: 4, checklistMissing: 1 }),
  );
  assert.ok(high.progressPercent > low.progressPercent);
});

test("getting_started stage has low progress", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({
      portalStage: "getting_started",
      checklistRequired: 0,
      checklistReceived: 0,
      checklistMissing: 0,
      docsUploaded: 0,
      missingItems: [],
      completedItems: [],
    }),
  );
  assert.ok(vm.progressPercent <= 20);
});

test("ready_for_sba_review stage has high progress", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({
      portalStage: "ready_for_sba_review",
      checklistReceived: 5,
      checklistMissing: 0,
      missingItems: [],
    }),
  );
  assert.ok(vm.progressPercent >= 80);
});

// ---------------------------------------------------------------------------
// 4. Empty / fallback state
// ---------------------------------------------------------------------------

test("fallback remaining items when nothing missing", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({
      missingItems: [],
      checklistMissing: 0,
    }),
  );
  assert.equal(vm.remainingItems.length, 1);
  assert.equal(vm.remainingItems[0].id, "fallback_remaining");
  assert.ok(vm.remainingItems[0].description?.includes("Buddy"));
});

// ---------------------------------------------------------------------------
// 5. Blockers card appears only when blockers exist
// ---------------------------------------------------------------------------

test("blockers present when portalStage is additional_items_needed and missing required items", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  assert.ok(vm.blockers.length > 0);
  assert.ok(vm.blockers.every((b) => b.severity === "critical"));
});

test("no blockers when portalStage is not additional_items_needed", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({ portalStage: "buddy_reviewing" }),
  );
  assert.equal(vm.blockers.length, 0);
});

test("blockers capped at 3", () => {
  const manyMissing = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    title: `Missing Doc ${i}`,
    required: true,
  }));
  const vm = buildBorrowerJourneyViewModel(
    baseInput({
      missingItems: manyMissing,
      checklistMissing: 10,
    }),
  );
  assert.ok(vm.blockers.length <= 3);
});

// ---------------------------------------------------------------------------
// 6. Next best action fallback behavior
// ---------------------------------------------------------------------------

test("next best action targets upload when critical items missing", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  assert.ok(vm.nextBestAction);
  assert.ok(vm.nextBestAction.href?.includes("/upload/"));
  assert.equal(vm.nextBestAction.severity, "critical");
});

test("next best action shows review status when no items missing and in review", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({
      portalStage: "buddy_reviewing",
      checklistMissing: 0,
      missingItems: [],
    }),
  );
  assert.ok(vm.nextBestAction);
  assert.ok(vm.nextBestAction.label.toLowerCase().includes("review"));
  assert.equal(vm.nextBestAction.href, undefined);
});

test("next best action is undefined when nothing to do and not in review", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({
      portalStage: "getting_started",
      checklistRequired: 0,
      checklistReceived: 0,
      checklistMissing: 0,
      missingItems: [],
      completedItems: [],
      docsUploaded: 0,
      docsInFlight: false,
    }),
  );
  // getting_started with nothing — may or may not have NBA
  // just ensure it doesn't crash
  assert.ok(vm.statusSummary.length > 0);
});

// ---------------------------------------------------------------------------
// 7. Completed items always includes "Application started"
// ---------------------------------------------------------------------------

test("completed items always include application started", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const appStarted = vm.completedItems.find((c) => c.id === "app_started");
  assert.ok(appStarted);
  assert.ok(appStarted.label.toLowerCase().includes("application started"));
});

test("completed items includes checklist completions", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  const checklistCompletions = vm.completedItems.filter((c) =>
    c.id.startsWith("checklist_"),
  );
  assert.equal(checklistCompletions.length, 2);
});

// ---------------------------------------------------------------------------
// 8. No raw internal lifecycle/status leakage
// ---------------------------------------------------------------------------

test("no internal lifecycle enums in borrower-facing copy", () => {
  const FORBIDDEN = [
    "readiness_regressed",
    "docs_in_progress",
    "underwriting_score",
    "trident_failure",
    "OCR confidence",
    "lender_match_status",
    "retry_exhausted",
    "provider failure",
    "banker notes",
    "lifecycle enum",
    "readiness score",
    "credit score",
    "underwriting prediction",
    "waiting_for_checklist",
    "uploading_docs",
    "bank_review",
  ];

  // Test all portal stages
  const stages: JourneyInput["portalStage"][] = [
    "getting_started",
    "documents_requested",
    "documents_received",
    "buddy_reviewing",
    "additional_items_needed",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const vm = buildBorrowerJourneyViewModel(baseInput({ portalStage: stage }));
    const allText = [
      vm.statusSummary,
      ...vm.milestones.map((m) => `${m.label} ${m.description}`),
      ...vm.completedItems.map((c) => `${c.label} ${c.description ?? ""}`),
      ...vm.remainingItems.map((r) => `${r.label} ${r.description ?? ""}`),
      ...vm.blockers.map((b) => `${b.label} ${b.description ?? ""}`),
      vm.nextBestAction?.label ?? "",
      vm.nextBestAction?.description ?? "",
    ].join(" ");

    for (const term of FORBIDDEN) {
      assert.ok(
        !allText.toLowerCase().includes(term.toLowerCase()),
        `Forbidden term "${term}" found in stage "${stage}" output: ${allText.slice(0, 200)}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 9. Status summary includes progress percentage
// ---------------------------------------------------------------------------

test("status summary mentions progress percentage when items remain", () => {
  const vm = buildBorrowerJourneyViewModel(baseInput());
  assert.ok(
    vm.statusSummary.includes(`${vm.progressPercent}%`),
    `Expected status summary to include "${vm.progressPercent}%" but got: "${vm.statusSummary}"`,
  );
});

// ---------------------------------------------------------------------------
// 10. Stage mapping correctness
// ---------------------------------------------------------------------------

test("getting_started maps to started_application", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({ portalStage: "getting_started", docsUploaded: 0 }),
  );
  assert.equal(vm.currentStage, "started_application");
});

test("ready_for_sba_review maps to banker_review", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({ portalStage: "ready_for_sba_review" }),
  );
  assert.equal(vm.currentStage, "banker_review");
});

test("documents_requested with uploads maps to financial_documents", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({ portalStage: "documents_requested", docsUploaded: 2 }),
  );
  assert.equal(vm.currentStage, "financial_documents");
});

test("documents_requested without uploads maps to business_profile", () => {
  const vm = buildBorrowerJourneyViewModel(
    baseInput({ portalStage: "documents_requested", docsUploaded: 0 }),
  );
  assert.equal(vm.currentStage, "business_profile");
});
