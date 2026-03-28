import test from "node:test";
import assert from "node:assert/strict";

import { deriveDealUrgency, type UrgencyInput } from "./deriveDealUrgency";

const BASE_INPUT: UrgencyInput = {
  isStageOverdue: false,
  isPrimaryActionStale: false,
  borrowerCampaignsOverdue: 0,
  criticalItemsOverdue: 0,
  uploadsWaitingReview: 0,
  bankerTasksStale: 0,
  activeEscalationCount: 0,
  stuckReasonCodes: [],
};

test("healthy deal scores 0 / healthy bucket", () => {
  const result = deriveDealUrgency(BASE_INPUT);
  assert.equal(result.urgencyScore, 0);
  assert.equal(result.urgencyBucket, "healthy");
});

test("borrower campaign overdue + critical items triggers watch", () => {
  const result = deriveDealUrgency({
    ...BASE_INPUT,
    borrowerCampaignsOverdue: 1,
    criticalItemsOverdue: 1,
  });
  assert.ok(result.urgencyScore >= 40);
  assert.equal(result.urgencyBucket, "urgent");
});

test("stale action + stage overdue triggers urgent", () => {
  const result = deriveDealUrgency({
    ...BASE_INPUT,
    isStageOverdue: true,
    isPrimaryActionStale: true,
  });
  assert.ok(result.urgencyScore >= 40);
  assert.equal(result.urgencyBucket, "urgent");
});

test("combined factors trigger critical", () => {
  const result = deriveDealUrgency({
    ...BASE_INPUT,
    isStageOverdue: true,
    isPrimaryActionStale: true,
    criticalItemsOverdue: 3,
    activeEscalationCount: 1,
  });
  assert.ok(result.urgencyScore >= 70);
  assert.equal(result.urgencyBucket, "critical");
});
