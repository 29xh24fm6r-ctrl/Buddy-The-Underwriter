/**
 * Gatekeeper Blocker Tests
 *
 * Tests that gatekeeper readiness blockers are emitted correctly
 * based on derived fields and stage metadata.
 *
 * No hardcoded stage names — uses stageRequiresDocuments() for stage gating.
 * Imports from pure modules only (no server-only).
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import type { LifecycleDerived, LifecycleStage } from "../model";
import { computeBlockers } from "../computeBlockers";
import { getBlockerFixAction } from "../nextAction";
import { LIFECYCLE_STAGES, stageRequiresDocuments } from "../stages";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal LifecycleDerived with sane defaults */
function baseDerived(overrides: Partial<LifecycleDerived> = {}): LifecycleDerived {
  return {
    documentsReady: true,
    documentsReadinessPct: 100,
    underwriteStarted: false,
    financialSnapshotExists: false,
    committeePacketReady: false,
    decisionPresent: false,
    committeeRequired: false,
    pricingQuoteReady: false,
    riskPricingFinalized: false,
    attestationSatisfied: true,
    aiPipelineComplete: true,
    spreadsComplete: true,
    structuralPricingReady: false,
    hasPricingAssumptions: false,
    hasSubmittedLoanRequest: false,
    researchComplete: true,
    ...overrides,
  };
}

/** Pick a stage that requires documents (for positive tests) */
const docStage: LifecycleStage = LIFECYCLE_STAGES.find(
  (s) => s.requiresDocuments,
)!.code;

/** Pick a stage that does NOT require documents (for negative tests) */
const nonDocStage: LifecycleStage = LIFECYCLE_STAGES.find(
  (s) => !s.requiresDocuments,
)!.code;

/** Extract only gatekeeper blockers from result */
function gkBlockers(stage: LifecycleStage, derived: LifecycleDerived) {
  return computeBlockers(stage, derived, 5, 1, false).filter(
    (b) =>
      b.code === "gatekeeper_docs_need_review" ||
      b.code === "gatekeeper_docs_incomplete",
  );
}

// ─── Emission Tests ─────────────────────────────────────────────────────────

describe("gatekeeper blocker emission", () => {
  test("no gatekeeper derived fields → no gatekeeper blockers", () => {
    const derived = baseDerived(); // no gatekeeperMissingBtrYears
    const blockers = gkBlockers(docStage, derived);
    assert.equal(blockers.length, 0);
  });

  test("readinessPct < 100 with missing years → gatekeeper_docs_incomplete", () => {
    const derived = baseDerived({
      gatekeeperReadinessPct: 60,
      gatekeeperMissingBtrYears: [2023, 2022],
      gatekeeperMissingPtrYears: [2023],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperNeedsReviewCount: 0,
    });
    const blockers = gkBlockers(docStage, derived);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].code, "gatekeeper_docs_incomplete");
  });

  test("needsReviewCount > 0 → gatekeeper_docs_need_review", () => {
    const derived = baseDerived({
      gatekeeperReadinessPct: 100,
      gatekeeperMissingBtrYears: [],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperNeedsReviewCount: 2,
    });
    const blockers = gkBlockers(docStage, derived);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].code, "gatekeeper_docs_need_review");
  });

  test("both conditions → both emitted, need_review first", () => {
    const derived = baseDerived({
      gatekeeperReadinessPct: 50,
      gatekeeperMissingBtrYears: [2022],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: true,
      gatekeeperNeedsReviewCount: 1,
    });
    const blockers = gkBlockers(docStage, derived);
    assert.equal(blockers.length, 2);
    assert.equal(blockers[0].code, "gatekeeper_docs_need_review");
    assert.equal(blockers[1].code, "gatekeeper_docs_incomplete");
  });

  test("readinessPct=100, needsReviewCount=0 → no blockers", () => {
    const derived = baseDerived({
      gatekeeperReadinessPct: 100,
      gatekeeperMissingBtrYears: [],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperNeedsReviewCount: 0,
    });
    const blockers = gkBlockers(docStage, derived);
    assert.equal(blockers.length, 0);
  });
});

// ─── Stage Gating Tests ────────────────────────────────────────────────────

describe("gatekeeper blocker stage gating", () => {
  const blockingDerived = baseDerived({
    gatekeeperReadinessPct: 50,
    gatekeeperMissingBtrYears: [2022],
    gatekeeperMissingPtrYears: [],
    gatekeeperMissingFinancialStatements: false,
    gatekeeperNeedsReviewCount: 1,
  });

  test("stages requiring documents → blockers fire", () => {
    for (const stageDef of LIFECYCLE_STAGES.filter((s) => s.requiresDocuments)) {
      const blockers = gkBlockers(stageDef.code, blockingDerived);
      assert.ok(
        blockers.length > 0,
        `Expected gatekeeper blockers for stage ${stageDef.code}`,
      );
    }
  });

  test("stages NOT requiring documents → blockers do NOT fire", () => {
    for (const stageDef of LIFECYCLE_STAGES.filter((s) => !s.requiresDocuments)) {
      const blockers = gkBlockers(stageDef.code, blockingDerived);
      assert.equal(
        blockers.length,
        0,
        `Expected no gatekeeper blockers for stage ${stageDef.code}`,
      );
    }
  });
});

// ─── Fix Action Tests ──────────────────────────────────────────────────────

describe("gatekeeper blocker fix actions", () => {
  test("gatekeeper_docs_need_review → href contains /documents", () => {
    const fix = getBlockerFixAction(
      { code: "gatekeeper_docs_need_review", message: "test" },
      "deal-123",
    );
    assert.ok(fix, "Expected a fix action");
    assert.ok("href" in fix && fix.href, "Expected href-based fix");
    assert.ok(
      fix.href!.includes("/documents"),
      `Expected href to contain /documents, got: ${fix.href}`,
    );
  });

  test("gatekeeper_docs_incomplete → href contains focus=documents", () => {
    const fix = getBlockerFixAction(
      { code: "gatekeeper_docs_incomplete", message: "test" },
      "deal-123",
    );
    assert.ok(fix, "Expected a fix action");
    assert.ok("href" in fix && fix.href, "Expected href-based fix");
    assert.ok(
      fix.href!.includes("focus=documents"),
      `Expected href to contain focus=documents, got: ${fix.href}`,
    );
  });
});

// ─── Evidence Tests ────────────────────────────────────────────────────────

describe("gatekeeper blocker evidence", () => {
  test("gatekeeper_docs_incomplete evidence has missingBusinessTaxYears", () => {
    const derived = baseDerived({
      gatekeeperReadinessPct: 40,
      gatekeeperMissingBtrYears: [2022, 2023],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperNeedsReviewCount: 0,
    });
    const blockers = gkBlockers(docStage, derived);
    const incomplete = blockers.find((b) => b.code === "gatekeeper_docs_incomplete");
    assert.ok(incomplete, "Expected gatekeeper_docs_incomplete blocker");
    assert.ok(incomplete.evidence, "Expected evidence on blocker");
    assert.deepEqual(incomplete.evidence!.missingBusinessTaxYears, [2022, 2023]);
  });

  test("gatekeeper_docs_need_review evidence has needsReviewCount", () => {
    const derived = baseDerived({
      gatekeeperReadinessPct: 100,
      gatekeeperMissingBtrYears: [],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperNeedsReviewCount: 3,
    });
    const blockers = gkBlockers(docStage, derived);
    const review = blockers.find((b) => b.code === "gatekeeper_docs_need_review");
    assert.ok(review, "Expected gatekeeper_docs_need_review blocker");
    assert.ok(review.evidence, "Expected evidence on blocker");
    assert.equal(review.evidence!.needsReviewCount, 3);
  });

  test("gatekeeper_docs_incomplete evidence includes missingFinancialStatements when true", () => {
    const derived = baseDerived({
      gatekeeperReadinessPct: 30,
      gatekeeperMissingBtrYears: [],
      gatekeeperMissingPtrYears: [2023],
      gatekeeperMissingFinancialStatements: true,
      gatekeeperNeedsReviewCount: 0,
    });
    const blockers = gkBlockers(docStage, derived);
    const incomplete = blockers.find((b) => b.code === "gatekeeper_docs_incomplete");
    assert.ok(incomplete, "Expected gatekeeper_docs_incomplete blocker");
    assert.equal(incomplete.evidence!.missingFinancialStatements, true);
    assert.deepEqual(incomplete.evidence!.missingPersonalTaxYears, [2023]);
  });
});

// ─── stageRequiresDocuments consistency ────────────────────────────────────

describe("stageRequiresDocuments", () => {
  test("every lifecycle stage has a definition", () => {
    const allStageCodes = LIFECYCLE_STAGES.map((s) => s.code);
    // Verify no duplicates
    assert.equal(allStageCodes.length, new Set(allStageCodes).size, "Duplicate stage codes");
    // Verify function returns boolean for every defined stage
    for (const stageDef of LIFECYCLE_STAGES) {
      const result = stageRequiresDocuments(stageDef.code);
      assert.equal(typeof result, "boolean");
    }
  });
});
