import test from "node:test";
import assert from "node:assert/strict";

import {
  requireStageOrBlock,
  requireMinimumStage,
  requireNoBlockers,
  PageGuards,
  getBlockerExplanation,
} from "../guards";
import type { LifecycleState } from "../model";

function makeState(
  stage: LifecycleState["stage"],
  blockers: LifecycleState["blockers"] = []
): LifecycleState {
  return {
    stage,
    lastAdvancedAt: null,
    blockers,
    derived: {
      requiredDocsReceivedPct: 0,
      requiredDocsMissing: [],
      borrowerChecklistSatisfied: false,
      underwriteStarted: false,
      financialSnapshotExists: false,
      committeePacketReady: false,
      decisionPresent: false,
      committeeRequired: false,
      attestationSatisfied: false,
    },
  };
}

// requireStageOrBlock tests
test("requireStageOrBlock allows when stage is in allowed list", () => {
  const state = makeState("underwrite_in_progress");
  const result = requireStageOrBlock(
    state,
    ["underwrite_in_progress", "committee_ready"],
    "/fallback"
  );
  assert.equal(result.ok, true);
});

test("requireStageOrBlock blocks when stage is not in allowed list", () => {
  const state = makeState("docs_in_progress");
  const result = requireStageOrBlock(
    state,
    ["underwrite_in_progress", "committee_ready"],
    "/fallback"
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.redirect, "/fallback");
    assert.equal(result.currentStage, "docs_in_progress");
  }
});

// requireMinimumStage tests
test("requireMinimumStage allows when at minimum stage", () => {
  const state = makeState("underwrite_ready");
  const result = requireMinimumStage(state, "underwrite_ready", "/fallback");
  assert.equal(result.ok, true);
});

test("requireMinimumStage allows when past minimum stage", () => {
  const state = makeState("committee_ready");
  const result = requireMinimumStage(state, "underwrite_ready", "/fallback");
  assert.equal(result.ok, true);
});

test("requireMinimumStage blocks when before minimum stage", () => {
  const state = makeState("docs_in_progress");
  const result = requireMinimumStage(state, "underwrite_ready", "/fallback");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.redirect, "/fallback");
    assert.equal(result.currentStage, "docs_in_progress");
  }
});

test("requireMinimumStage handles workout stage", () => {
  const state = makeState("workout");
  // Workout is accessible from committee_decisioned onwards
  const resultDecision = requireMinimumStage(state, "committee_decisioned", "/fallback");
  assert.equal(resultDecision.ok, true);

  const resultDocs = requireMinimumStage(state, "docs_satisfied", "/fallback");
  assert.equal(resultDocs.ok, true);
});

// requireNoBlockers tests
test("requireNoBlockers allows when no blockers", () => {
  const state = makeState("docs_in_progress", []);
  const result = requireNoBlockers(state, "/fallback");
  assert.equal(result.ok, true);
});

test("requireNoBlockers blocks when blockers present", () => {
  const state = makeState("docs_in_progress", [
    { code: "missing_required_docs", message: "Missing documents" },
  ]);
  const result = requireNoBlockers(state, "/fallback");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].code, "missing_required_docs");
  }
});

// PageGuards tests
test("PageGuards.underwrite requires underwrite_ready", () => {
  const readyState = makeState("underwrite_ready");
  const readyResult = PageGuards.underwrite(readyState, "deal-123");
  assert.equal(readyResult.ok, true);

  const docsState = makeState("docs_satisfied");
  const docsResult = PageGuards.underwrite(docsState, "deal-123");
  assert.equal(docsResult.ok, false);
  if (!docsResult.ok) {
    assert.equal(docsResult.redirect, "/deals/deal-123/cockpit");
  }
});

test("PageGuards.committee requires committee_ready", () => {
  // Committee is accessible at committee_ready and beyond
  const committeeReadyState = makeState("committee_ready");
  const committeeReadyResult = PageGuards.committee(committeeReadyState, "deal-123");
  assert.equal(committeeReadyResult.ok, true);

  const decisionedState = makeState("committee_decisioned");
  const decisionedResult = PageGuards.committee(decisionedState, "deal-123");
  assert.equal(decisionedResult.ok, true);

  // Committee is NOT accessible at underwrite_in_progress
  const uwState = makeState("underwrite_in_progress");
  const uwResult = PageGuards.committee(uwState, "deal-123");
  assert.equal(uwResult.ok, false);
  if (!uwResult.ok) {
    assert.equal(uwResult.redirect, "/deals/deal-123/cockpit");
  }

  // Committee is NOT accessible at underwrite_ready
  const readyState = makeState("underwrite_ready");
  const readyResult = PageGuards.committee(readyState, "deal-123");
  assert.equal(readyResult.ok, false);
});

test("PageGuards.decision requires committee_ready", () => {
  const committeeState = makeState("committee_ready");
  const committeeResult = PageGuards.decision(committeeState, "deal-123");
  assert.equal(committeeResult.ok, true);

  const uwState = makeState("underwrite_in_progress");
  const uwResult = PageGuards.decision(uwState, "deal-123");
  assert.equal(uwResult.ok, false);
});

test("PageGuards.closing requires committee_decisioned", () => {
  const decisionedState = makeState("committee_decisioned");
  const decisionedResult = PageGuards.closing(decisionedState, "deal-123");
  assert.equal(decisionedResult.ok, true);

  const committeeState = makeState("committee_ready");
  const committeeResult = PageGuards.closing(committeeState, "deal-123");
  assert.equal(committeeResult.ok, false);
});

// getBlockerExplanation tests
test("getBlockerExplanation returns null for ok result", () => {
  const result = { ok: true as const };
  assert.equal(getBlockerExplanation(result), null);
});

test("getBlockerExplanation returns blocker messages", () => {
  const result = {
    ok: false as const,
    redirect: "/fallback",
    blockers: [
      { code: "missing_required_docs" as const, message: "Missing docs" },
      { code: "financial_snapshot_missing" as const, message: "No financials" },
    ],
    currentStage: "docs_in_progress" as const,
  };
  const explanation = getBlockerExplanation(result);
  assert.equal(explanation, "Missing docs; No financials");
});

test("getBlockerExplanation returns stage message when no blockers", () => {
  const result = {
    ok: false as const,
    redirect: "/fallback",
    blockers: [],
    currentStage: "docs_in_progress" as const,
  };
  const explanation = getBlockerExplanation(result);
  assert.equal(explanation, 'Deal is currently in "docs_in_progress" stage');
});
