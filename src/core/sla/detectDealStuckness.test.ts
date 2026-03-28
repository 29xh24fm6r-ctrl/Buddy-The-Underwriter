import test from "node:test";
import assert from "node:assert/strict";

// Direct import of pure function (no server-only)
import { detectDealStuckness, type StucknessInput } from "./detectDealStuckness";

const BASE_INPUT: StucknessInput = {
  canonicalStage: "docs_in_progress",
  stageAgeHours: 10,
  primaryActionCode: "request_documents",
  primaryActionPriority: "normal",
  primaryActionAgeHours: 10,
  borrowerCampaignsOpen: 0,
  borrowerCampaignsOverdue: 0,
  criticalItemsOverdue: 0,
  bankerTasksStale: 0,
  uploadsWaitingReview: 0,
  hasUnresolvedMemoBlockers: false,
  hasUnresolvedPricingBlockers: false,
  isClosingStage: false,
  isBorrowerBlocking: false,
};

test("healthy deal is not stuck", () => {
  const result = detectDealStuckness(BASE_INPUT);
  assert.equal(result.isDealStuck, false);
  assert.equal(result.stuckReasonCodes.length, 0);
});

test("stage overdue triggers stage_overdue", () => {
  const result = detectDealStuckness({ ...BASE_INPUT, stageAgeHours: 100 });
  assert.ok(result.isDealStuck);
  assert.ok(result.stuckReasonCodes.includes("stage_overdue"));
});

test("stale critical primary action triggers primary_action_stale", () => {
  const result = detectDealStuckness({
    ...BASE_INPUT,
    primaryActionPriority: "critical",
    primaryActionAgeHours: 30,
  });
  assert.ok(result.isDealStuck);
  assert.ok(result.stuckReasonCodes.includes("primary_action_stale"));
});

test("overdue borrower campaigns with critical items triggers borrower_unresponsive", () => {
  const result = detectDealStuckness({
    ...BASE_INPUT,
    borrowerCampaignsOverdue: 2,
    criticalItemsOverdue: 3,
  });
  assert.ok(result.isDealStuck);
  assert.ok(result.stuckReasonCodes.includes("borrower_unresponsive"));
});

test("uploads waiting for review triggers uploads_waiting_for_review", () => {
  const result = detectDealStuckness({
    ...BASE_INPUT,
    uploadsWaitingReview: 2,
    bankerTasksStale: 1,
  });
  assert.ok(result.isDealStuck);
  assert.ok(result.stuckReasonCodes.includes("uploads_waiting_for_review"));
});

test("banker inactive on critical action triggers banker_inactive_on_critical_action", () => {
  const result = detectDealStuckness({
    ...BASE_INPUT,
    primaryActionPriority: "critical",
    primaryActionAgeHours: 30,
    isBorrowerBlocking: false,
  });
  assert.ok(result.stuckReasonCodes.includes("banker_inactive_on_critical_action"));
});

test("memo blockers aging triggers memo_gap_aging", () => {
  const result = detectDealStuckness({
    ...BASE_INPUT,
    hasUnresolvedMemoBlockers: true,
    stageAgeHours: 30,
  });
  assert.ok(result.stuckReasonCodes.includes("memo_gap_aging"));
});

test("pricing blockers aging triggers pricing_waiting_on_assumptions", () => {
  const result = detectDealStuckness({
    ...BASE_INPUT,
    hasUnresolvedPricingBlockers: true,
    stageAgeHours: 30,
  });
  assert.ok(result.stuckReasonCodes.includes("pricing_waiting_on_assumptions"));
});

test("closing stalled triggers closing_stalled", () => {
  const result = detectDealStuckness({
    ...BASE_INPUT,
    canonicalStage: "closing_in_progress",
    isClosingStage: true,
    stageAgeHours: 100,
  });
  assert.ok(result.stuckReasonCodes.includes("closing_stalled"));
});
