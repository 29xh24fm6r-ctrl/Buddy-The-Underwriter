/**
 * Phase 65H — Blocking Party Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveBlockingParty, type BlockingPartyInput } from "./deriveBlockingParty";

const BASE: BlockingPartyInput = {
  borrowerOverdueCount: 0,
  borrowerRemindersExhausted: false,
  borrowerCampaignStatus: null,
  isPrimaryActionStale: false,
  primaryActionPriority: null,
  reviewBacklogCount: 0,
  isQueueJobRunning: false,
};

describe("deriveBlockingParty", () => {
  it("returns borrower when borrower items are overdue", () => {
    const result = deriveBlockingParty({ ...BASE, borrowerOverdueCount: 3 });
    assert.equal(result, "borrower");
  });

  it("returns borrower when reminders are exhausted", () => {
    const result = deriveBlockingParty({ ...BASE, borrowerRemindersExhausted: true });
    assert.equal(result, "borrower");
  });

  it("returns banker when primary action is stale", () => {
    const result = deriveBlockingParty({
      ...BASE,
      isPrimaryActionStale: true,
      primaryActionPriority: "critical",
    });
    assert.equal(result, "banker");
  });

  it("returns banker when review backlog exists", () => {
    const result = deriveBlockingParty({ ...BASE, reviewBacklogCount: 5 });
    assert.equal(result, "banker");
  });

  it("returns buddy when queue job is running and nobody else blocking", () => {
    const result = deriveBlockingParty({ ...BASE, isQueueJobRunning: true });
    assert.equal(result, "buddy");
  });

  it("returns mixed when both borrower and banker are blocking", () => {
    const result = deriveBlockingParty({
      ...BASE,
      borrowerOverdueCount: 2,
      reviewBacklogCount: 3,
    });
    assert.equal(result, "mixed");
  });

  it("returns unknown when nothing is blocking", () => {
    const result = deriveBlockingParty(BASE);
    assert.equal(result, "unknown");
  });
});
