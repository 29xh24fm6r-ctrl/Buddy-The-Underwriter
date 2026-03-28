/**
 * Phase 65H — Queue Reason Code Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveQueueReasonCode, type QueueReasonInput } from "./deriveQueueReasonCode";

const BASE: QueueReasonInput = {
  isStageOverdue: false,
  isPrimaryActionStale: false,
  primaryActionPriority: null,
  borrowerRemindersExhausted: false,
  borrowerOverdueCount: 0,
  reviewBacklogCount: 0,
  blockerCodes: [],
  canonicalStage: "docs_in_progress",
  stuckReasonCodes: [],
};

describe("deriveQueueReasonCode", () => {
  it("returns critical_stage_overdue when stage SLA breached", () => {
    const result = deriveQueueReasonCode({ ...BASE, isStageOverdue: true });
    assert.equal(result, "critical_stage_overdue");
  });

  it("returns critical_primary_action_stale for stale critical action", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      isPrimaryActionStale: true,
      primaryActionPriority: "critical",
    });
    assert.equal(result, "critical_primary_action_stale");
  });

  it("returns borrower_reminders_exhausted", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      borrowerRemindersExhausted: true,
    });
    assert.equal(result, "borrower_reminders_exhausted");
  });

  it("returns borrower_items_overdue", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      borrowerOverdueCount: 2,
    });
    assert.equal(result, "borrower_items_overdue");
  });

  it("returns uploads_waiting_review", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      reviewBacklogCount: 5,
    });
    assert.equal(result, "uploads_waiting_review");
  });

  it("returns readiness_blocked for readiness blocker codes", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      blockerCodes: ["readiness_not_satisfied"],
    });
    assert.equal(result, "readiness_blocked");
  });

  it("returns memo_gap_aging for memo blocker codes", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      blockerCodes: ["committee_packet_missing"],
    });
    assert.equal(result, "memo_gap_aging");
  });

  it("returns pricing_waiting for pricing blocker codes", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      blockerCodes: ["pricing_quote_missing"],
    });
    assert.equal(result, "pricing_waiting");
  });

  it("returns committee_ready when stage is committee_ready", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      canonicalStage: "committee_ready",
    });
    assert.equal(result, "committee_ready");
  });

  it("returns closing_stalled when closing and stuck", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      canonicalStage: "closing_in_progress",
      stuckReasonCodes: ["closing_stalled"],
    });
    assert.equal(result, "closing_stalled");
  });

  it("returns healthy_monitoring by default", () => {
    const result = deriveQueueReasonCode(BASE);
    assert.equal(result, "healthy_monitoring");
  });

  it("stage overdue takes precedence over everything else", () => {
    const result = deriveQueueReasonCode({
      ...BASE,
      isStageOverdue: true,
      isPrimaryActionStale: true,
      primaryActionPriority: "critical",
      borrowerRemindersExhausted: true,
      reviewBacklogCount: 10,
    });
    assert.equal(result, "critical_stage_overdue");
  });
});
