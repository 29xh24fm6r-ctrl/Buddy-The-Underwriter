/**
 * Phase 65H — Command Center Summary Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveCommandCenterSummary } from "./deriveCommandCenterSummary";
import type { BankerQueueItem } from "./types";

function makeItem(overrides: Partial<BankerQueueItem> = {}): BankerQueueItem {
  return {
    dealId: "d1",
    dealName: "Test Deal",
    borrowerName: null,
    canonicalStage: "docs_in_progress",
    urgencyBucket: "healthy",
    urgencyScore: 0,
    queueDomain: "general",
    queueReasonCode: "healthy_monitoring",
    queueReasonLabel: "Healthy",
    queueReasonDescription: "All good",
    blockingParty: "unknown",
    primaryActionCode: null,
    primaryActionLabel: null,
    primaryActionPriority: null,
    primaryActionAgeHours: null,
    isActionExecutable: false,
    actionability: "monitor_only",
    href: "/deals/d1",
    activeEscalationCount: 0,
    borrowerOverdueCount: 0,
    reviewBacklogCount: 0,
    latestActivityAt: null,
    changedSinceViewed: false,
    ...overrides,
  };
}

describe("deriveCommandCenterSummary", () => {
  it("counts total deals", () => {
    const items = [makeItem(), makeItem({ dealId: "d2" })];
    const result = deriveCommandCenterSummary(items, 0);
    assert.equal(result.totalDeals, 2);
  });

  it("counts critical and urgent items", () => {
    const items = [
      makeItem({ urgencyBucket: "critical" }),
      makeItem({ urgencyBucket: "urgent", dealId: "d2" }),
      makeItem({ urgencyBucket: "urgent", dealId: "d3" }),
      makeItem({ urgencyBucket: "healthy", dealId: "d4" }),
    ];
    const result = deriveCommandCenterSummary(items, 0);
    assert.equal(result.criticalCount, 1);
    assert.equal(result.urgentCount, 2);
  });

  it("counts borrower waiting on bank", () => {
    const items = [
      makeItem({ blockingParty: "banker" }),
      makeItem({ queueReasonCode: "uploads_waiting_review", dealId: "d2" }),
    ];
    const result = deriveCommandCenterSummary(items, 0);
    assert.equal(result.borrowerWaitingOnBankCount, 2);
  });

  it("counts bank waiting on borrower", () => {
    const items = [
      makeItem({ blockingParty: "borrower" }),
      makeItem({ queueReasonCode: "borrower_items_overdue", dealId: "d2" }),
    ];
    const result = deriveCommandCenterSummary(items, 0);
    assert.equal(result.bankWaitingOnBorrowerCount, 2);
  });

  it("passes through auto-advanced today count", () => {
    const result = deriveCommandCenterSummary([], 5);
    assert.equal(result.autoAdvancedTodayCount, 5);
  });

  it("counts stale primary actions", () => {
    const items = [
      makeItem({ primaryActionAgeHours: 48 }),
      makeItem({ primaryActionAgeHours: 12, dealId: "d2" }),
      makeItem({
        queueReasonCode: "critical_primary_action_stale",
        dealId: "d3",
      }),
    ];
    const result = deriveCommandCenterSummary(items, 0);
    assert.equal(result.stalePrimaryActionCount, 2); // 48h > 24 + critical_primary_action_stale
  });
});
