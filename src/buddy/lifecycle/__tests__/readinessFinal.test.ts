/**
 * Readiness Final Tests
 *
 * Tests the final architecture: gatekeeper is the sole document readiness
 * authority. No legacy checklist, no dual sources, no flags.
 *
 * Imports from pure modules only (no server-only).
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import type { LifecycleDerived, LifecycleStage } from "../model";
import { computeBlockers } from "../computeBlockers";

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

function blockerCodes(stage: LifecycleStage, derived: LifecycleDerived, checklistCount = 5): string[] {
  return computeBlockers(stage, derived, checklistCount, 1, false).map((b) => b.code);
}

// ─── No Legacy Blockers ──────────────────────────────────────────────────────

describe("legacy blockers permanently removed", () => {
  test("missing_required_docs never emitted regardless of state", () => {
    const derived = baseDerived({
      documentsReady: false,
      documentsReadinessPct: 50,
    });
    const codes = blockerCodes("docs_in_progress", derived);
    assert.ok(!codes.includes("missing_required_docs"), `Should never emit missing_required_docs, got: ${codes}`);
  });

  test("ai_pipeline_incomplete never emitted regardless of state", () => {
    const derived = baseDerived({
      documentsReady: false,
      documentsReadinessPct: 50,
      aiPipelineComplete: false,
    });
    const codes = blockerCodes("docs_in_progress", derived);
    assert.ok(!codes.includes("ai_pipeline_incomplete"), `Should never emit ai_pipeline_incomplete, got: ${codes}`);
  });
});

// ─── Gatekeeper Blockers (sole authority) ────────────────────────────────────

describe("gatekeeper blockers", () => {
  test("gatekeeper_docs_incomplete emitted when readinessPct < 100", () => {
    const derived = baseDerived({
      documentsReady: false,
      documentsReadinessPct: 60,
      gatekeeperMissingBtrYears: [2023],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperReadinessPct: 60,
      gatekeeperNeedsReviewCount: 0,
    });
    const codes = blockerCodes("docs_in_progress", derived);
    assert.ok(codes.includes("gatekeeper_docs_incomplete"), `Expected gatekeeper_docs_incomplete, got: ${codes}`);
  });

  test("gatekeeper_docs_need_review emitted when needsReviewCount > 0", () => {
    const derived = baseDerived({
      documentsReady: false,
      documentsReadinessPct: 100,
      gatekeeperMissingBtrYears: [],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperReadinessPct: 100,
      gatekeeperNeedsReviewCount: 2,
    });
    const codes = blockerCodes("docs_in_progress", derived);
    assert.ok(codes.includes("gatekeeper_docs_need_review"), `Expected gatekeeper_docs_need_review, got: ${codes}`);
  });

  test("both gatekeeper blockers emitted when both conditions met", () => {
    const derived = baseDerived({
      documentsReady: false,
      documentsReadinessPct: 50,
      gatekeeperMissingBtrYears: [2022],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: true,
      gatekeeperReadinessPct: 50,
      gatekeeperNeedsReviewCount: 1,
    });
    const codes = blockerCodes("docs_in_progress", derived);
    assert.ok(codes.includes("gatekeeper_docs_incomplete"), "Gatekeeper incomplete fires");
    assert.ok(codes.includes("gatekeeper_docs_need_review"), "Gatekeeper review fires");
  });

  test("no gatekeeper blockers when readinessPct=100 and needsReviewCount=0", () => {
    const derived = baseDerived({
      documentsReady: true,
      documentsReadinessPct: 100,
      gatekeeperMissingBtrYears: [],
      gatekeeperMissingPtrYears: [],
      gatekeeperMissingFinancialStatements: false,
      gatekeeperReadinessPct: 100,
      gatekeeperNeedsReviewCount: 0,
    });
    const codes = blockerCodes("docs_in_progress", derived);
    assert.ok(!codes.includes("gatekeeper_docs_incomplete"), "No incomplete blocker");
    assert.ok(!codes.includes("gatekeeper_docs_need_review"), "No review blocker");
  });
});

// ─── Non-Document Blockers Unaffected ────────────────────────────────────────

describe("non-document blockers unaffected by gatekeeper-only architecture", () => {
  test("checklist_not_seeded still emitted for intake stage", () => {
    const derived = baseDerived();
    const codes = computeBlockers("intake_created", derived, 0, 0, false).map((b) => b.code);
    assert.ok(codes.includes("checklist_not_seeded"), `Expected checklist_not_seeded, got: ${codes}`);
  });

  test("loan_request_missing still emitted", () => {
    const derived = baseDerived();
    const codes = computeBlockers("docs_in_progress", derived, 5, 0, false).map((b) => b.code);
    assert.ok(codes.includes("loan_request_missing"), `Expected loan_request_missing, got: ${codes}`);
  });

  test("pricing_assumptions_required still emitted", () => {
    const derived = baseDerived({ hasPricingAssumptions: false });
    const codes = blockerCodes("docs_satisfied", derived);
    assert.ok(codes.includes("pricing_assumptions_required"), `Expected pricing_assumptions_required, got: ${codes}`);
  });

  test("financial_snapshot_missing still emitted", () => {
    const derived = baseDerived({ financialSnapshotExists: false });
    const codes = blockerCodes("underwrite_ready", derived);
    assert.ok(codes.includes("financial_snapshot_missing"), `Expected financial_snapshot_missing, got: ${codes}`);
  });
});

// ─── Model Shape Tests ──────────────────────────────────────────────────────

describe("LifecycleDerived shape — no legacy fields", () => {
  test("documentsReady is required (non-optional boolean)", () => {
    const derived = baseDerived();
    assert.equal(typeof derived.documentsReady, "boolean");
  });

  test("documentsReadinessPct is required (non-optional number)", () => {
    const derived = baseDerived();
    assert.equal(typeof derived.documentsReadinessPct, "number");
  });

  test("no borrowerChecklistSatisfied field exists", () => {
    const derived = baseDerived();
    assert.ok(!("borrowerChecklistSatisfied" in derived), "borrowerChecklistSatisfied should not exist");
  });

  test("no requiredDocsReceivedPct field exists", () => {
    const derived = baseDerived();
    assert.ok(!("requiredDocsReceivedPct" in derived), "requiredDocsReceivedPct should not exist");
  });

  test("no requiredDocsMissing field exists", () => {
    const derived = baseDerived();
    assert.ok(!("requiredDocsMissing" in derived), "requiredDocsMissing should not exist");
  });

  test("no documentsReadinessSource field exists", () => {
    const derived = baseDerived();
    assert.ok(!("documentsReadinessSource" in derived), "documentsReadinessSource should not exist");
  });
});
