/**
 * Phase 65I — Monitoring Blocking Party Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveMonitoringBlockingParty,
  type MonitoringBlockingInput,
} from "./deriveMonitoringBlockingParty";

const BASE: MonitoringBlockingInput = {
  cycleStatus: "due",
  requiresBorrowerSubmission: true,
  requiresBankerReview: true,
  submissionReceived: false,
  reviewStarted: false,
};

describe("deriveMonitoringBlockingParty", () => {
  it("returns borrower when submission not received", () => {
    assert.equal(deriveMonitoringBlockingParty(BASE), "borrower");
  });

  it("returns banker when submitted but no review", () => {
    assert.equal(
      deriveMonitoringBlockingParty({ ...BASE, submissionReceived: true }),
      "banker",
    );
  });

  it("returns banker for under_review status", () => {
    assert.equal(
      deriveMonitoringBlockingParty({
        ...BASE,
        cycleStatus: "under_review",
        submissionReceived: true,
        reviewStarted: true,
      }),
      "banker",
    );
  });

  it("returns unknown for completed cycles", () => {
    assert.equal(
      deriveMonitoringBlockingParty({ ...BASE, cycleStatus: "completed" }),
      "unknown",
    );
  });

  it("returns unknown for upcoming cycles", () => {
    assert.equal(
      deriveMonitoringBlockingParty({ ...BASE, cycleStatus: "upcoming" }),
      "unknown",
    );
  });
});
