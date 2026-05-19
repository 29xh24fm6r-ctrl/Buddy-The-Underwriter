import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerGuidanceViewModel,
  type GuidanceInput,
} from "@/lib/borrower/buildBorrowerGuidanceViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<GuidanceInput> = {}): GuidanceInput {
  return {
    borrowerName: "Jane Doe",
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
    missingItems: [
      { id: "m1", title: "Business Tax Returns", required: true },
      { id: "m2", title: "Voided Business Check", required: true },
      { id: "m3", title: "Debt Schedule", required: false },
    ],
    completedItems: [
      { id: "c1", title: "Personal Financial Statement" },
      { id: "c2", title: "Business License" },
    ],
    hasActivity: true,
    recommendationCount: 2,
    portalStage: "additional_items_needed",
    token: "test-token",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Minimal input fallback
// ---------------------------------------------------------------------------

test("minimal input produces valid guidance with fallback", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      checklistRequired: 0,
      checklistReceived: 0,
      checklistMissing: 0,
      docsUploaded: 0,
      docsVerified: 0,
      profileCompleteness: 0,
      ownershipVerified: false,
      blockerCount: 0,
      readinessScore: 0,
      missingItems: [],
      completedItems: [],
      hasActivity: false,
      recommendationCount: 0,
      portalStage: "getting_started",
    }),
  );
  assert.ok(vm.headline.length > 0);
  assert.ok(vm.summary.length > 0);
  assert.ok(vm.nextStep.headline.length > 0);
  assert.ok(vm.whatHappensNext.length > 0);
  assert.ok(vm.reassurance.message.length > 0);
});

// ---------------------------------------------------------------------------
// 2. Blocker-driven next step
// ---------------------------------------------------------------------------

test("blockers drive resolve_blocker focus", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ blockerCount: 3 }),
  );
  assert.equal(vm.nextStep.focus, "resolve_blocker");
  assert.ok(vm.nextStep.href?.includes("/upload/"));
});

// ---------------------------------------------------------------------------
// 3. Missing-document coaching
// ---------------------------------------------------------------------------

test("coached items use coaching map for known documents", () => {
  const vm = buildBorrowerGuidanceViewModel(baseInput());
  assert.ok(vm.coachedItems.length > 0);
  assert.ok(vm.coachedItems.length <= 3);
  // Business Tax Returns should get coaching
  const taxItem = vm.coachedItems.find((i) => i.label.toLowerCase().includes("tax"));
  assert.ok(taxItem, "Expected coached tax return item");
  assert.ok(taxItem.whyItMatters, "Expected whyItMatters for tax returns");
  assert.ok(taxItem.helpfulUploadHint, "Expected upload hint for tax returns");
});

test("coached items for voided check get coaching", () => {
  const vm = buildBorrowerGuidanceViewModel(baseInput());
  const checkItem = vm.coachedItems.find((i) => i.label.toLowerCase().includes("voided") || i.label.toLowerCase().includes("check"));
  assert.ok(checkItem, "Expected coached voided check item");
});

// ---------------------------------------------------------------------------
// 4. No-action-needed state
// ---------------------------------------------------------------------------

test("wait_for_review focus when no missing items and in review", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      checklistMissing: 0,
      blockerCount: 0,
      missingItems: [],
      recommendationCount: 0,
      ownershipVerified: true,
      portalStage: "ready_for_sba_review",
    }),
  );
  assert.equal(vm.nextStep.focus, "wait_for_review");
  assert.equal(vm.nextStep.ctaLabel, undefined);
  assert.equal(vm.nextStep.href, undefined);
});

// ---------------------------------------------------------------------------
// 5. Friction signals
// ---------------------------------------------------------------------------

test("many_items_remaining signal when 4+ missing", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ checklistMissing: 5 }),
  );
  assert.ok(vm.frictionSignals.includes("many_items_remaining"));
});

test("package_nearly_complete signal when 1-2 missing", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      checklistRequired: 6,
      checklistMissing: 1,
      missingItems: [{ id: "m1", title: "Debt Schedule", required: true }],
    }),
  );
  assert.ok(vm.frictionSignals.includes("package_nearly_complete"));
});

test("low_readiness_with_uploads signal", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      docsUploaded: 5,
      readinessScore: 20,
    }),
  );
  assert.ok(vm.frictionSignals.includes("low_readiness_with_uploads"));
});

test("not_started signal when nothing done", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      completedItems: [],
      docsUploaded: 0,
    }),
  );
  assert.ok(vm.frictionSignals.includes("not_started"));
});

test("blocked signal when blockers present", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ blockerCount: 2, portalStage: "additional_items_needed" }),
  );
  assert.ok(vm.frictionSignals.includes("blocked"));
});

test("waiting_for_review signal", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ portalStage: "buddy_reviewing" }),
  );
  assert.ok(vm.frictionSignals.includes("waiting_for_review"));
});

test("ready_no_action_needed signal", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      checklistMissing: 0,
      blockerCount: 0,
      portalStage: "ready_for_sba_review",
    }),
  );
  assert.ok(vm.frictionSignals.includes("ready_no_action_needed"));
});

// ---------------------------------------------------------------------------
// 6. What-happens-next derivation
// ---------------------------------------------------------------------------

test("what-happens-next includes remaining items step when missing", () => {
  const vm = buildBorrowerGuidanceViewModel(baseInput());
  assert.ok(vm.whatHappensNext.some((s) => s.title === "Remaining items"));
});

test("what-happens-next includes submission prep when complete", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ checklistMissing: 0, blockerCount: 0 }),
  );
  assert.ok(vm.whatHappensNext.some((s) => s.title === "Submission preparation"));
});

test("what-happens-next includes review step when in review", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ portalStage: "buddy_reviewing" }),
  );
  assert.ok(vm.whatHappensNext.some((s) => s.title === "Package review"));
});

// ---------------------------------------------------------------------------
// 7. Reassurance tone selection
// ---------------------------------------------------------------------------

test("positive reassurance when ready and no action needed", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      checklistMissing: 0,
      blockerCount: 0,
      portalStage: "ready_for_sba_review",
    }),
  );
  assert.equal(vm.reassurance.tone, "positive");
});

test("attention reassurance when blocked", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ blockerCount: 3, portalStage: "additional_items_needed" }),
  );
  assert.equal(vm.reassurance.tone, "attention");
});

test("neutral reassurance for not_started", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      completedItems: [],
      docsUploaded: 0,
      portalStage: "getting_started",
    }),
  );
  assert.equal(vm.reassurance.tone, "neutral");
});

// ---------------------------------------------------------------------------
// 8. Max 3 coached items
// ---------------------------------------------------------------------------

test("coached items capped at 3", () => {
  const manyMissing = Array.from({ length: 8 }, (_, i) => ({
    id: `m${i}`,
    title: `Missing Doc ${i}`,
    required: true,
  }));
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ missingItems: manyMissing }),
  );
  assert.ok(vm.coachedItems.length <= 3);
});

// ---------------------------------------------------------------------------
// 9. No forbidden borrower-facing terms
// ---------------------------------------------------------------------------

test("no forbidden terms in guidance view model", () => {
  const FORBIDDEN = [
    "docs_in_progress",
    "lifecycle",
    "credit_memo",
    "supabase",
    "underwriting_queue",
    "approval odds",
    "guaranteed",
    "you qualify",
    "you are approved",
    "your loan will",
    "guaranteed funding",
    "probability of approval",
    "risk score",
    "internal review queue",
  ];

  const stages: GuidanceInput["portalStage"][] = [
    "getting_started",
    "documents_requested",
    "buddy_reviewing",
    "additional_items_needed",
    "ready_for_sba_review",
  ];

  for (const stage of stages) {
    const vm = buildBorrowerGuidanceViewModel(baseInput({ portalStage: stage }));
    const allText = [
      vm.headline,
      vm.summary,
      vm.nextStep.headline,
      vm.nextStep.description,
      vm.nextStep.ctaLabel ?? "",
      ...vm.coachedItems.flatMap((c) => [
        c.label, c.explanation, c.whyItMatters ?? "", c.helpfulUploadHint ?? "", c.commonIssueToAvoid ?? "",
      ]),
      ...vm.whatHappensNext.flatMap((w) => [w.title, w.description]),
      vm.reassurance.message,
    ].join(" ");

    for (const term of FORBIDDEN) {
      assert.ok(
        !allText.toLowerCase().includes(term.toLowerCase()),
        `Forbidden term "${term}" in stage "${stage}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 10. Deterministic output
// ---------------------------------------------------------------------------

test("same input produces identical output", () => {
  const input = baseInput();
  const vm1 = buildBorrowerGuidanceViewModel(input);
  const vm2 = buildBorrowerGuidanceViewModel(input);
  assert.deepStrictEqual(vm1, vm2);
});

// ---------------------------------------------------------------------------
// 11. Headline includes borrower name
// ---------------------------------------------------------------------------

test("headline includes borrower name when provided", () => {
  const vm = buildBorrowerGuidanceViewModel(baseInput());
  assert.ok(vm.headline.includes("Jane"));
});

test("headline works without borrower name", () => {
  const vm = buildBorrowerGuidanceViewModel(baseInput({ borrowerName: null }));
  assert.ok(!vm.headline.includes("null"));
  assert.ok(vm.headline.length > 0);
});

// ---------------------------------------------------------------------------
// 12. Focus-driven adaptive behavior
// ---------------------------------------------------------------------------

test("upload_required_document focus when required items missing", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({ blockerCount: 0 }),
  );
  assert.equal(vm.nextStep.focus, "upload_required_document");
});

test("complete_profile focus when profile low and no required missing", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      missingItems: [],
      blockerCount: 0,
      profileCompleteness: 0.3,
      recommendationCount: 0,
    }),
  );
  assert.equal(vm.nextStep.focus, "complete_profile");
});

test("review_recommendations focus when items complete but recs remain", () => {
  const vm = buildBorrowerGuidanceViewModel(
    baseInput({
      missingItems: [],
      checklistMissing: 0,
      blockerCount: 0,
      profileCompleteness: 0.8,
      ownershipVerified: true,
      recommendationCount: 3,
    }),
  );
  assert.equal(vm.nextStep.focus, "review_recommendations");
});
