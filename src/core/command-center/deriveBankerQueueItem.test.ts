/**
 * Phase 65H — Banker Queue Item Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveBankerQueueItem } from "./deriveBankerQueueItem";
import type { QueueItemDerivationInput } from "./types";
import type { DealAgingSnapshot } from "@/core/sla/types";

function makeAging(overrides: Partial<DealAgingSnapshot> = {}): DealAgingSnapshot {
  return {
    dealId: "d1",
    canonicalStage: "docs_in_progress",
    stageStartedAt: "2026-03-20T00:00:00Z",
    stageAgeHours: 24,
    primaryActionCode: null,
    primaryActionAgeHours: null,
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
    ...overrides,
  };
}

function makeInput(overrides: Partial<QueueItemDerivationInput> = {}): QueueItemDerivationInput {
  return {
    dealId: "d1",
    dealName: "Test Deal",
    borrowerName: "John Doe",
    canonicalStage: "docs_in_progress",
    blockerCodes: [],
    primaryActionCode: null,
    primaryActionLabel: null,
    primaryActionPriority: null,
    isActionExecutable: false,
    agingSnapshot: makeAging(),
    borrowerCampaignStatus: null,
    borrowerOverdueCount: 0,
    borrowerRemindersExhausted: false,
    reviewBacklogCount: 0,
    activeEscalationCount: 0,
    latestActivityAt: null,
    changedSinceViewed: false,
    ...overrides,
  };
}

describe("deriveBankerQueueItem", () => {
  it("produces one item per deal", () => {
    const item = deriveBankerQueueItem(
      makeInput(),
      { executionMode: null, isQueueJobRunning: false },
    );
    assert.equal(item.dealId, "d1");
    assert.equal(item.dealName, "Test Deal");
  });

  it("critical stale banker-owned action -> banker blocking, urgent/critical", () => {
    const item = deriveBankerQueueItem(
      makeInput({
        primaryActionCode: "review_uploaded_documents",
        primaryActionLabel: "Review uploads",
        primaryActionPriority: "critical",
        agingSnapshot: makeAging({
          isPrimaryActionStale: true,
          primaryActionAgeHours: 48,
          urgencyBucket: "critical",
          urgencyScore: 90,
        }),
      }),
      { executionMode: "task_only", isQueueJobRunning: false },
    );
    assert.equal(item.queueReasonCode, "critical_primary_action_stale");
    assert.equal(item.blockingParty, "banker");
    assert.equal(item.urgencyBucket, "critical");
  });

  it("borrower overdue campaign -> borrower blocking, waiting_on_borrower", () => {
    const item = deriveBankerQueueItem(
      makeInput({
        borrowerCampaignStatus: "in_progress",
        borrowerOverdueCount: 3,
      }),
      { executionMode: null, isQueueJobRunning: false },
    );
    assert.equal(item.queueReasonCode, "borrower_items_overdue");
    assert.equal(item.blockingParty, "borrower");
    assert.equal(item.actionability, "waiting_on_borrower");
  });

  it("uploads waiting review -> banker blocking, review_required", () => {
    const item = deriveBankerQueueItem(
      makeInput({ reviewBacklogCount: 5 }),
      { executionMode: null, isQueueJobRunning: false },
    );
    assert.equal(item.queueReasonCode, "uploads_waiting_review");
    assert.equal(item.blockingParty, "banker");
    assert.equal(item.actionability, "review_required");
  });

  it("healthy deal -> monitor_only", () => {
    const item = deriveBankerQueueItem(
      makeInput(),
      { executionMode: null, isQueueJobRunning: false },
    );
    assert.equal(item.queueReasonCode, "healthy_monitoring");
    assert.equal(item.actionability, "monitor_only");
  });

  it("executable primary action -> execute_now", () => {
    const item = deriveBankerQueueItem(
      makeInput({
        primaryActionCode: "generate_financial_snapshot",
        primaryActionLabel: "Generate snapshot",
        primaryActionPriority: "high",
        isActionExecutable: true,
      }),
      { executionMode: "queue_job", isQueueJobRunning: false },
    );
    assert.equal(item.actionability, "execute_now");
    assert.equal(item.isActionExecutable, true);
  });

  it("sets href based on queue reason", () => {
    const item = deriveBankerQueueItem(
      makeInput({ blockerCodes: ["pricing_quote_missing"] }),
      { executionMode: null, isQueueJobRunning: false },
    );
    assert.equal(item.queueReasonCode, "pricing_waiting");
    assert.equal(item.href, "/deals/d1/pricing");
  });

  it("preserves changedSinceViewed from input", () => {
    const item = deriveBankerQueueItem(
      makeInput({ changedSinceViewed: true }),
      { executionMode: null, isQueueJobRunning: false },
    );
    assert.equal(item.changedSinceViewed, true);
  });
});
