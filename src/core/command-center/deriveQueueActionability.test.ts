/**
 * Phase 65H — Queue Actionability Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveQueueActionability,
  type ActionabilityInput,
} from "./deriveQueueActionability";

const BASE: ActionabilityInput = {
  isActionExecutable: false,
  executionMode: null,
  blockingParty: "unknown",
  queueReasonCode: "healthy_monitoring",
  reviewBacklogCount: 0,
};

describe("deriveQueueActionability", () => {
  it("returns execute_now for direct_write executable action", () => {
    const result = deriveQueueActionability({
      ...BASE,
      isActionExecutable: true,
      executionMode: "direct_write",
    });
    assert.equal(result, "execute_now");
  });

  it("returns execute_now for queue_job executable action", () => {
    const result = deriveQueueActionability({
      ...BASE,
      isActionExecutable: true,
      executionMode: "queue_job",
    });
    assert.equal(result, "execute_now");
  });

  it("returns waiting_on_borrower when borrower is blocking", () => {
    const result = deriveQueueActionability({
      ...BASE,
      blockingParty: "borrower",
      queueReasonCode: "borrower_items_overdue",
    });
    assert.equal(result, "waiting_on_borrower");
  });

  it("returns review_required when review backlog exists", () => {
    const result = deriveQueueActionability({
      ...BASE,
      reviewBacklogCount: 3,
      queueReasonCode: "uploads_waiting_review",
    });
    assert.equal(result, "review_required");
  });

  it("returns open_panel for task_only actions", () => {
    const result = deriveQueueActionability({
      ...BASE,
      executionMode: "task_only",
      queueReasonCode: "readiness_blocked",
    });
    assert.equal(result, "open_panel");
  });

  it("returns monitor_only for healthy deals", () => {
    const result = deriveQueueActionability(BASE);
    assert.equal(result, "monitor_only");
  });
});
