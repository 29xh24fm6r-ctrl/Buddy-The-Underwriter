/**
 * Phase 65I — Monitoring Severity Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveMonitoringSeverity, type SeverityInput } from "./deriveMonitoringSeverity";

const BASE: SeverityInput = {
  cycleStatus: "upcoming",
  dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  hasOpenException: false,
  isCovenantRelated: false,
  overdueCount: 0,
};

describe("deriveMonitoringSeverity", () => {
  it("returns healthy for upcoming cycles", () => {
    assert.equal(deriveMonitoringSeverity(BASE), "healthy");
  });

  it("returns healthy for completed cycles", () => {
    assert.equal(
      deriveMonitoringSeverity({ ...BASE, cycleStatus: "completed" }),
      "healthy",
    );
  });

  it("returns watch for due cycle within 7 days", () => {
    const dueSoon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(
      deriveMonitoringSeverity({ ...BASE, cycleStatus: "due", dueAt: dueSoon }),
      "watch",
    );
  });

  it("returns watch for under_review", () => {
    assert.equal(
      deriveMonitoringSeverity({ ...BASE, cycleStatus: "under_review" }),
      "watch",
    );
  });

  it("returns urgent for overdue cycles", () => {
    assert.equal(
      deriveMonitoringSeverity({ ...BASE, cycleStatus: "overdue" }),
      "urgent",
    );
  });

  it("returns urgent for exception_open cycles", () => {
    assert.equal(
      deriveMonitoringSeverity({ ...BASE, cycleStatus: "exception_open" }),
      "urgent",
    );
  });

  it("returns critical for covenant-related with open exception", () => {
    assert.equal(
      deriveMonitoringSeverity({
        ...BASE,
        cycleStatus: "overdue",
        isCovenantRelated: true,
        hasOpenException: true,
      }),
      "critical",
    );
  });

  it("returns critical for repeated overdue (2+)", () => {
    assert.equal(
      deriveMonitoringSeverity({
        ...BASE,
        cycleStatus: "overdue",
        overdueCount: 2,
      }),
      "critical",
    );
  });
});
