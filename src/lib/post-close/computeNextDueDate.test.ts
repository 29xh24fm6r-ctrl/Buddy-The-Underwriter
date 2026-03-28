/**
 * Phase 65I — Due Date Computation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeNextDueDate, generateDueDatesInWindow } from "./computeNextDueDate";

describe("computeNextDueDate", () => {
  it("monthly: returns next month due day", () => {
    const ref = new Date(2026, 2, 15); // March 15
    const result = computeNextDueDate("monthly", ref, 1, null);
    assert.equal(result.getMonth(), 3); // April
    assert.equal(result.getDate(), 1);
  });

  it("quarterly: returns next quarter boundary", () => {
    const ref = new Date(2026, 1, 15); // Feb 15 (Q1)
    const result = computeNextDueDate("quarterly", ref, 15, null);
    assert.equal(result.getMonth(), 3); // April (Q2 start)
  });

  it("annual: returns next year if this year passed", () => {
    const ref = new Date(2026, 6, 1); // July 1
    const result = computeNextDueDate("annual", ref, 1, 3); // March 1
    assert.equal(result.getFullYear(), 2027);
    assert.equal(result.getMonth(), 2); // March
  });

  it("annual: returns this year if still upcoming", () => {
    const ref = new Date(2026, 0, 15); // Jan 15
    const result = computeNextDueDate("annual", ref, 1, 6); // June 1
    assert.equal(result.getFullYear(), 2026);
    assert.equal(result.getMonth(), 5); // June
  });

  it("one_time: returns 30 days from reference", () => {
    const ref = new Date(2026, 0, 1);
    const result = computeNextDueDate("one_time", ref, null, null);
    const diff = Math.floor((result.getTime() - ref.getTime()) / (24 * 60 * 60 * 1000));
    assert.equal(diff, 30);
  });
});

describe("generateDueDatesInWindow", () => {
  it("generates multiple quarterly dates within window", () => {
    const start = new Date(2026, 0, 1); // Jan 1
    const end = new Date(2026, 11, 31); // Dec 31
    const dates = generateDueDatesInWindow("quarterly", start, end, 1, null);
    assert.ok(dates.length >= 3, `Expected >= 3 dates, got ${dates.length}`);
  });

  it("generates single one_time date", () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31);
    const dates = generateDueDatesInWindow("one_time", start, end, null, null);
    assert.equal(dates.length, 1);
  });

  it("returns empty if due date is past window", () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 15); // Only 15 days
    const dates = generateDueDatesInWindow("annual", start, end, 1, 6); // June
    assert.equal(dates.length, 0);
  });
});
