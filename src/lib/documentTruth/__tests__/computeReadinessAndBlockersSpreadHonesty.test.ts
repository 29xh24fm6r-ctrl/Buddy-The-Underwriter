/**
 * STUCK-SPREADS Batch 3 (2026-04-23) — readiness panel spread honesty.
 *
 * Pure-function unit tests: no DB, no network. Verify that the spreads
 * category reports "warning" (not "complete") when rows exist but any
 * are non-terminal or stuck.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeReadinessAndBlockers,
  type ReadinessInput,
  type SpreadStats,
} from "../computeReadinessAndBlockers";

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    requirements: [],
    hasLoanRequest: true,
    spreadStats: { total: 0, terminal: 0, stuck: 0, stuckTypes: [] },
    hasFinancialSnapshot: false,
    hasPricingQuote: false,
    hasDecision: false,
    ...overrides,
  };
}

function spreadStats(partial: Partial<SpreadStats>): SpreadStats {
  return {
    total: 0,
    terminal: 0,
    stuck: 0,
    stuckTypes: [],
    ...partial,
  };
}

function pickSpreadStatus(result: ReturnType<typeof computeReadinessAndBlockers>) {
  return result.categories.find((c) => c.code === "spreads")?.status;
}

describe("readiness panel — honest spread status", () => {
  test("no spreads → warning", () => {
    const out = computeReadinessAndBlockers(
      baseInput({ spreadStats: spreadStats({ total: 0 }) }),
    );
    assert.equal(pickSpreadStatus(out), "warning");
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_stuck"),
      "no stuck blocker when no spreads exist",
    );
  });

  test("all spreads terminal (ready/error) → complete", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({ total: 6, terminal: 6 }),
      }),
    );
    assert.equal(pickSpreadStatus(out), "complete");
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_stuck"),
      "no stuck blocker when everything terminal",
    );
  });

  test("stuck rows present → warning + spreads_stuck blocker lists types", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({
          total: 6,
          terminal: 5,
          stuck: 1,
          stuckTypes: ["PERSONAL_FINANCIAL_STATEMENT"],
        }),
      }),
    );

    assert.equal(
      pickSpreadStatus(out),
      "warning",
      "spread status must be warning when any row is stuck",
    );

    const blocker = out.blockers.find((b) => b.code === "spreads_stuck");
    assert.ok(blocker, "must emit spreads_stuck blocker");
    assert.equal(blocker!.severity, "warning");
    assert.ok(
      blocker!.title.includes("1 of 6"),
      `blocker title must include the ratio ("1 of 6"): got "${blocker!.title}"`,
    );
    assert.ok(
      blocker!.details.join(" ").includes("PERSONAL_FINANCIAL_STATEMENT"),
      "blocker details must name the stuck spread type",
    );
  });

  test("in-flight (non-terminal, not yet stuck) → warning, no blocker", () => {
    // total=6, terminal=4, stuck=0 → 2 rows are generating under threshold
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({ total: 6, terminal: 4, stuck: 0 }),
      }),
    );
    assert.equal(
      pickSpreadStatus(out),
      "warning",
      "non-terminal in-flight rows must not be reported as complete",
    );
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_stuck"),
      "no stuck blocker when no row exceeded staleness threshold",
    );
  });
});
