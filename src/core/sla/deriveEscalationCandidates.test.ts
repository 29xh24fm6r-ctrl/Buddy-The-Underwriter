import test from "node:test";
import assert from "node:assert/strict";

import { deriveEscalationCandidates } from "./deriveEscalationCandidates";
import type { DealAgingSnapshot } from "./types";

const BASE_SNAPSHOT: DealAgingSnapshot = {
  dealId: "test-deal",
  canonicalStage: "docs_in_progress",
  stageStartedAt: null,
  stageAgeHours: 10,
  primaryActionCode: "request_documents",
  primaryActionAgeHours: 10,
  borrowerCampaignsOpen: 0,
  borrowerCampaignsOverdue: 0,
  criticalItemsOverdue: 0,
  bankerTasksStale: 0,
  isStageOverdue: false,
  isPrimaryActionStale: false,
  isDealStuck: false,
  urgencyScore: 0,
  urgencyBucket: "healthy",
  stuckReasonCodes: [],
};

test("no stuck reasons produces no escalations", () => {
  const candidates = deriveEscalationCandidates(BASE_SNAPSHOT);
  assert.equal(candidates.length, 0);
});

test("stage_overdue produces stage escalation", () => {
  const candidates = deriveEscalationCandidates({
    ...BASE_SNAPSHOT,
    stuckReasonCodes: ["stage_overdue"],
    stageAgeHours: 100,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].escalationCode, "stage_overdue");
  assert.ok(candidates[0].severity === "urgent" || candidates[0].severity === "critical");
});

test("primary_action_stale produces action escalation", () => {
  const candidates = deriveEscalationCandidates({
    ...BASE_SNAPSHOT,
    stuckReasonCodes: ["primary_action_stale"],
    primaryActionAgeHours: 50,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].escalationCode, "primary_action_stale");
});

test("borrower_unresponsive produces reminder exhausted escalation", () => {
  const candidates = deriveEscalationCandidates({
    ...BASE_SNAPSHOT,
    stuckReasonCodes: ["borrower_unresponsive"],
    borrowerCampaignsOverdue: 2,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].escalationCode, "borrower_reminders_exhausted");
});

test("multiple stuck reasons produce multiple escalations", () => {
  const candidates = deriveEscalationCandidates({
    ...BASE_SNAPSHOT,
    stuckReasonCodes: ["stage_overdue", "primary_action_stale", "borrower_unresponsive"],
    stageAgeHours: 100,
    primaryActionAgeHours: 50,
    borrowerCampaignsOverdue: 1,
  });
  assert.equal(candidates.length, 3);
});
