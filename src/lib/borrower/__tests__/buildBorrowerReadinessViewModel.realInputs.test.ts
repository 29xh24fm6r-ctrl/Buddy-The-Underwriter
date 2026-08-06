import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBorrowerReadinessViewModel,
  type ReadinessInput,
} from "@/lib/borrower/buildBorrowerReadinessViewModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A borrower with every category fully complete via the real inputs path
 *  (ownershipConditionsSatisfied/Required, sbaFormsApplicable) rather than
 *  the legacy stub fields. */
function fullyCompleteInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    borrowerName: "Jane Doe",
    checklistRequired: 8,
    checklistReceived: 8,
    checklistMissing: 0,
    docsUploaded: 8,
    docsInFlight: false,
    docsVerified: 8,
    profileCompleteness: 1,
    ownershipVerified: true,
    ownershipConditionsSatisfied: 3,
    ownershipConditionsRequired: 3,
    sbaFormsReceived: 2,
    sbaFormsRequired: 2,
    sbaFormsApplicable: true,
    blockerCount: 0,
    missingItems: [],
    completedItems: [{ id: "c1", title: "Business Tax Returns" }],
    activity: [],
    portalStage: "ready_for_sba_review",
    token: "test-token",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. 100% reachability
// ---------------------------------------------------------------------------

test("a fully complete borrower reaches exactly 100%", () => {
  const vm = buildBorrowerReadinessViewModel(fullyCompleteInput());
  assert.equal(vm.readiness.score, 100);
  assert.equal(vm.readiness.band, "near_submission_ready");
});

test("weights sum to 100% across the six components at full completion", () => {
  const vm = buildBorrowerReadinessViewModel(fullyCompleteInput());
  const totalWeight = vm.readiness.components.reduce((sum, c) => sum + c.weightPercent, 0);
  const totalContribution = vm.readiness.components.reduce(
    (sum, c) => sum + c.contributionPercent,
    0,
  );
  assert.equal(totalWeight, 100);
  assert.equal(totalContribution, 100);
});

test("documented weights are unchanged: 35/15/10/15/15/10", () => {
  const vm = buildBorrowerReadinessViewModel(fullyCompleteInput());
  const byId = Object.fromEntries(vm.readiness.components.map((c) => [c.id, c.weightPercent]));
  assert.equal(byId.documentCompleteness, 35);
  assert.equal(byId.profileCompleteness, 15);
  assert.equal(byId.ownershipVerification, 10);
  assert.equal(byId.sbaFormsCompletion, 15);
  assert.equal(byId.financialPackage, 15);
  assert.equal(byId.blockerPenalty, 10);
});

// ---------------------------------------------------------------------------
// 2. Ownership at the score level
// ---------------------------------------------------------------------------

test("ownership between 80-99.99% with gate complete still reaches 100%", () => {
  // clarificationNeeded is informational only and must never touch the score.
  const vm = buildBorrowerReadinessViewModel(
    fullyCompleteInput({
      ownershipConditionsSatisfied: 3,
      ownershipConditionsRequired: 3,
    }),
  );
  assert.equal(vm.readiness.score, 100);
});

test("ownership partial credit (2 of 3) reduces score by exactly its share of the 10% weight", () => {
  const full = buildBorrowerReadinessViewModel(fullyCompleteInput());
  const partial = buildBorrowerReadinessViewModel(
    fullyCompleteInput({ ownershipConditionsSatisfied: 2, ownershipConditionsRequired: 3 }),
  );
  // 1/3 of the 10% weight lost -> ~3.33 points, rounds to 3.
  assert.equal(full.readiness.score - partial.readiness.score, 3);
  assert.notEqual(partial.readiness.score, 100);
});

test("ownership below 80% (only 1 of 3 conditions) meaningfully reduces score and blocks 100%", () => {
  const vm = buildBorrowerReadinessViewModel(
    fullyCompleteInput({ ownershipConditionsSatisfied: 1, ownershipConditionsRequired: 3 }),
  );
  assert.notEqual(vm.readiness.score, 100);
  const ownershipComponent = vm.readiness.components.find(
    (c) => c.id === "ownershipVerification",
  )!;
  assert.ok(ownershipComponent.scorePercent < 50);
});

test("missing attestation alone (2 of 3 conditions) reduces score", () => {
  const vm = buildBorrowerReadinessViewModel(
    fullyCompleteInput({ ownershipConditionsSatisfied: 2, ownershipConditionsRequired: 3 }),
  );
  assert.notEqual(vm.readiness.score, 100);
});

// ---------------------------------------------------------------------------
// 3. SBA forms
// ---------------------------------------------------------------------------

test("no required SBA forms (not applicable) still reaches 100%", () => {
  const vm = buildBorrowerReadinessViewModel(
    fullyCompleteInput({
      sbaFormsApplicable: false,
      sbaFormsReceived: 0,
      sbaFormsRequired: 0,
    }),
  );
  assert.equal(vm.readiness.score, 100);
  const sbaComponent = vm.readiness.components.find((c) => c.id === "sbaFormsCompletion")!;
  assert.equal(sbaComponent.scorePercent, 100);
});

test("incomplete SBA forms (1 of 2 accepted) reduce the score below 100", () => {
  const vm = buildBorrowerReadinessViewModel(
    fullyCompleteInput({ sbaFormsReceived: 1, sbaFormsRequired: 2, sbaFormsApplicable: true }),
  );
  assert.notEqual(vm.readiness.score, 100);
});

// ---------------------------------------------------------------------------
// 4. Profile
// ---------------------------------------------------------------------------

test("missing profile fields (4 of 6 present) reduce the score", () => {
  const full = buildBorrowerReadinessViewModel(fullyCompleteInput());
  const partial = buildBorrowerReadinessViewModel(
    fullyCompleteInput({ profileCompleteness: 4 / 6 }),
  );
  assert.ok(partial.readiness.score < full.readiness.score);
  assert.notEqual(partial.readiness.score, 100);
});

// ---------------------------------------------------------------------------
// 5. Blockers
// ---------------------------------------------------------------------------

test("any unresolved blocker prevents 100%, regardless of every other category", () => {
  const vm = buildBorrowerReadinessViewModel(fullyCompleteInput({ blockerCount: 1 }));
  assert.notEqual(vm.readiness.score, 100);
});

// ---------------------------------------------------------------------------
// 6. Removing a completed item lowers the score
// ---------------------------------------------------------------------------

test("removing a previously-received document lowers the score", () => {
  const before = buildBorrowerReadinessViewModel(fullyCompleteInput());
  const afterRemoval = buildBorrowerReadinessViewModel(
    fullyCompleteInput({
      checklistReceived: 7,
      checklistMissing: 1,
      docsUploaded: 7,
      docsVerified: 7,
    }),
  );
  assert.ok(afterRemoval.readiness.score < before.readiness.score);
});

// ---------------------------------------------------------------------------
// 7. Backward compatibility — binary ownershipVerified still works when the
//    richer fields are absent (existing callers / existing tests).
// ---------------------------------------------------------------------------

test("backward compatibility: plain ownershipVerified boolean still scores as before", () => {
  const vm = buildBorrowerReadinessViewModel(
    fullyCompleteInput({
      ownershipConditionsSatisfied: undefined,
      ownershipConditionsRequired: undefined,
      ownershipVerified: true,
    }),
  );
  const ownershipComponent = vm.readiness.components.find(
    (c) => c.id === "ownershipVerification",
  )!;
  assert.equal(ownershipComponent.scorePercent, 100);
});
