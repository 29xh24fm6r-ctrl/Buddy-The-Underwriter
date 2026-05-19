import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerReadinessViewModel,
  type ReadinessInput,
  type BorrowerReadinessViewModel,
} from "@/lib/borrower/buildBorrowerReadinessViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    borrowerName: "Jane Doe",
    checklistRequired: 6,
    checklistReceived: 3,
    checklistMissing: 3,
    docsUploaded: 5,
    docsInFlight: false,
    docsVerified: 3,
    profileCompleteness: 0.7,
    ownershipVerified: false,
    sbaFormsReceived: 1,
    sbaFormsRequired: 2,
    blockerCount: 2,
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
      { id: "m2", title: "Voided Business Check", required: true },
      { id: "m3", title: "Debt Schedule", required: false },
    ],
    completedItems: [
      { id: "c1", title: "Personal Financial Statement" },
      { id: "c2", title: "Business License" },
      { id: "c3", title: "SBA Form 1919" },
    ],
    activity: [
      { id: "a1", title: "Buddy reviewed your tax returns", detail: "Filed in package.", createdAt: "2026-05-18T10:00:00Z", kind: "review" },
      { id: "a2", title: "Document uploaded", detail: "Business License received.", createdAt: "2026-05-17T14:00:00Z", kind: "upload" },
    ],
    portalStage: "additional_items_needed",
    token: "test-token",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Readiness band mapping
// ---------------------------------------------------------------------------

test("early_stage band for very low completeness", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({
      checklistRequired: 10,
      checklistReceived: 0,
      checklistMissing: 10,
      docsUploaded: 0,
      docsVerified: 0,
      profileCompleteness: 0.1,
      blockerCount: 5,
    }),
  );
  assert.equal(vm.readiness.band, "early_stage");
  assert.ok(vm.readiness.score < 25);
});

test("progressing band for moderate completeness", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  assert.ok(
    vm.readiness.band === "progressing" || vm.readiness.band === "strong_progress",
    `Expected progressing or strong_progress, got ${vm.readiness.band}`,
  );
});

test("near_submission_ready for high completeness", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({
      checklistRequired: 6,
      checklistReceived: 6,
      checklistMissing: 0,
      docsUploaded: 8,
      docsVerified: 7,
      profileCompleteness: 1.0,
      ownershipVerified: true,
      sbaFormsReceived: 2,
      sbaFormsRequired: 2,
      blockerCount: 0,
      missingItems: [],
    }),
  );
  assert.equal(vm.readiness.band, "near_submission_ready");
  assert.ok(vm.readiness.score >= 80);
});

// ---------------------------------------------------------------------------
// 2. Readiness score rendering (0-100 range)
// ---------------------------------------------------------------------------

test("readiness score is between 0 and 100", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  assert.ok(vm.readiness.score >= 0);
  assert.ok(vm.readiness.score <= 100);
});

test("readiness score increases with more completeness", () => {
  const low = buildBorrowerReadinessViewModel(
    baseInput({ checklistReceived: 0, checklistMissing: 6 }),
  );
  const high = buildBorrowerReadinessViewModel(
    baseInput({ checklistReceived: 5, checklistMissing: 1 }),
  );
  assert.ok(high.readiness.score > low.readiness.score);
});

// ---------------------------------------------------------------------------
// 3. Delta calculation
// ---------------------------------------------------------------------------

test("delta computed when previousScore provided", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({ previousScore: 30 }),
  );
  assert.ok(vm.readiness.delta != null);
  assert.equal(vm.readiness.delta, vm.readiness.score - 30);
});

test("no delta when previousScore not provided", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  assert.equal(vm.readiness.delta, undefined);
});

// ---------------------------------------------------------------------------
// 4. Positive insight derivation
// ---------------------------------------------------------------------------

test("insights are derived from real state", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  assert.ok(vm.insights.length > 0);
  // With 5 docs uploaded and 3 verified, we should get document-related insights
  const docInsight = vm.insights.find((i) => i.type === "document" || i.type === "progress");
  assert.ok(docInsight, "Expected at least one document or progress insight");
});

test("ownership insight appears when verified", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({ ownershipVerified: true }),
  );
  const ownerInsight = vm.insights.find((i) => i.id === "ownership_verified");
  assert.ok(ownerInsight);
  assert.equal(ownerInsight.type, "verification");
});

test("fallback insight when no data", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({
      docsUploaded: 0,
      docsVerified: 0,
      profileCompleteness: 0,
      ownershipVerified: false,
      sbaFormsReceived: 0,
      checklistReceived: 0,
      checklistMissing: 6,
      completedItems: [],
    }),
  );
  assert.ok(vm.insights.length > 0);
  assert.equal(vm.insights[0].id, "getting_started");
});

// ---------------------------------------------------------------------------
// 5. Recommendation prioritization
// ---------------------------------------------------------------------------

test("recommendations are max 3", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  assert.ok(vm.recommendations.length <= 3);
});

test("high-priority recommendations come from required missing items", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  const highPri = vm.recommendations.filter((r) => r.priority === "high");
  assert.ok(highPri.length > 0);
  assert.ok(highPri[0].label.toLowerCase().includes("tax return") || highPri[0].label.toLowerCase().includes("business"));
});

test("fallback recommendation when nothing missing", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({
      missingItems: [],
      checklistMissing: 0,
      profileCompleteness: 1.0,
      ownershipVerified: true,
    }),
  );
  assert.ok(vm.recommendations.length >= 1);
  assert.equal(vm.recommendations[0].id, "rec_fallback");
});

// ---------------------------------------------------------------------------
// 6. Safe empty states
// ---------------------------------------------------------------------------

test("empty activity produces empty feed", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({ activity: [] }),
  );
  assert.equal(vm.activity.length, 0);
});

test("document stats work with zero checklist", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({
      checklistRequired: 0,
      checklistReceived: 0,
      checklistMissing: 0,
    }),
  );
  assert.ok(vm.documentCompletionPercent >= 0);
  assert.ok(vm.documentCompletionPercent <= 100);
});

// ---------------------------------------------------------------------------
// 7. Activity feed borrower-safe rendering
// ---------------------------------------------------------------------------

test("activity events preserve borrower-safe categories", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  assert.equal(vm.activity.length, 2);
  assert.equal(vm.activity[0].category, "review");
  assert.equal(vm.activity[1].category, "upload");
});

test("activity events limited to 8", () => {
  const manyEvents = Array.from({ length: 15 }, (_, i) => ({
    id: `a${i}`,
    title: `Event ${i}`,
    detail: "Detail",
    createdAt: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
    kind: "review" as const,
  }));
  const vm = buildBorrowerReadinessViewModel(
    baseInput({ activity: manyEvents }),
  );
  assert.ok(vm.activity.length <= 8);
});

// ---------------------------------------------------------------------------
// 8. No internal lifecycle leakage
// ---------------------------------------------------------------------------

test("no forbidden terms in readiness view model copy", () => {
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
    "approval odds",
    "guaranteed funding",
  ];

  const stages: ReadinessInput["portalStage"][] = [
    "getting_started",
    "documents_requested",
    "documents_received",
    "buddy_reviewing",
    "additional_items_needed",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const vm = buildBorrowerReadinessViewModel(baseInput({ portalStage: stage }));
    const allText = [
      vm.readiness.summary,
      ...vm.insights.map((i) => `${i.label} ${i.description ?? ""}`),
      ...vm.recommendations.map((r) => `${r.label} ${r.explanation ?? ""}`),
      ...vm.activity.map((a) => a.label),
    ].join(" ");

    for (const term of FORBIDDEN) {
      assert.ok(
        !allText.toLowerCase().includes(term.toLowerCase()),
        `Forbidden term "${term}" found in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 9. Readiness summary is borrower-friendly
// ---------------------------------------------------------------------------

test("readiness summary includes borrower name when available", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  assert.ok(vm.readiness.summary.includes("Jane"));
});

test("readiness summary works without borrower name", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({ borrowerName: null }),
  );
  assert.ok(vm.readiness.summary.includes("Your"));
  assert.ok(!vm.readiness.summary.includes("null"));
});

// ---------------------------------------------------------------------------
// 10. Document completion stats
// ---------------------------------------------------------------------------

test("document completion percent reflects checklist ratio", () => {
  const vm = buildBorrowerReadinessViewModel(
    baseInput({ checklistReceived: 4, checklistMissing: 2 }),
  );
  assert.ok(vm.documentCompletionPercent > 50);
});

test("document stats breakdown is consistent", () => {
  const vm = buildBorrowerReadinessViewModel(baseInput());
  const { received, remaining } = vm.documentStats;
  assert.equal(received, 3);
  assert.equal(remaining, 3);
});

// ---------------------------------------------------------------------------
// 11. Readiness score weighting sanity
// ---------------------------------------------------------------------------

test("ownership verification improves score", () => {
  const without = buildBorrowerReadinessViewModel(
    baseInput({ ownershipVerified: false }),
  );
  const with_ = buildBorrowerReadinessViewModel(
    baseInput({ ownershipVerified: true }),
  );
  assert.ok(with_.readiness.score > without.readiness.score);
});

test("fewer blockers improve score", () => {
  const many = buildBorrowerReadinessViewModel(
    baseInput({ blockerCount: 5 }),
  );
  const few = buildBorrowerReadinessViewModel(
    baseInput({ blockerCount: 0 }),
  );
  assert.ok(few.readiness.score > many.readiness.score);
});
