/**
 * STUCK-SPREADS Batch 3 (2026-04-23) — readiness panel spread honesty.
 * READINESS-HONESTY-FOLLOWUP (2026-04-24) — split terminal into ready (success)
 * vs errored (terminal but failed); errored rows count as warning, not complete.
 *
 * Pure-function unit tests: no DB, no network. Verify that the spreads
 * category reports "warning" (not "complete") when rows exist but any
 * are non-terminal, stuck, or errored — and that the category reports
 * "complete" only when all rows are in `ready` (successful) status.
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
    spreadStats: spreadStats({}),
    hasFinancialSnapshot: false,
    hasPricingQuote: false,
    hasDecision: false,
    ...overrides,
  };
}

function spreadStats(partial: Partial<SpreadStats>): SpreadStats {
  const base: SpreadStats = {
    total: 0,
    ready: 0,
    errored: 0,
    erroredTypes: [],
    terminal: 0,
    stuck: 0,
    stuckTypes: [],
    ...partial,
  };
  // Keep the `terminal` field consistent with ready + errored unless caller
  // explicitly overrides (back-compat semantics).
  if (partial.terminal === undefined) {
    base.terminal = base.ready + base.errored;
  }
  return base;
}

function pickSpreadStatus(result: ReturnType<typeof computeReadinessAndBlockers>) {
  return result.categories.find((c) => c.code === "spreads")?.status;
}

describe("readiness panel — honest spread status", () => {
  test("no spreads (total === 0) → warning, no spread blockers (regression)", () => {
    const out = computeReadinessAndBlockers(
      baseInput({ spreadStats: spreadStats({ total: 0 }) }),
    );
    assert.equal(pickSpreadStatus(out), "warning");
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_stuck"),
      "no stuck blocker when no spreads exist",
    );
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_errored"),
      "no errored blocker when no spreads exist",
    );
  });

  test("all ready, no errored, no stuck → complete, no spread blockers", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({ total: 6, ready: 6 }),
      }),
    );
    assert.equal(pickSpreadStatus(out), "complete");
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_stuck"),
      "no stuck blocker when everything is ready",
    );
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_errored"),
      "no errored blocker when everything is ready",
    );
  });

  test("stuck rows present → warning + spreads_stuck blocker (regression)", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({
          total: 6,
          ready: 5,
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
      `stuck blocker title must include the ratio ("1 of 6"): got "${blocker!.title}"`,
    );
    assert.ok(
      blocker!.details.join(" ").includes("PERSONAL_FINANCIAL_STATEMENT"),
      "stuck blocker details must name the stuck spread type",
    );
  });

  test("in-flight (non-terminal, not yet stuck) → warning, no blocker (regression)", () => {
    // 2 rows are generating under threshold — neither ready nor errored nor stuck
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({ total: 6, ready: 4 }),
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
    assert.ok(
      !out.blockers.some((b) => b.code === "spreads_errored"),
      "no errored blocker when nothing is errored",
    );
  });

  // ─── READINESS-HONESTY-FOLLOWUP new cases ─────────────────────────────────

  test("one errored → warning + spreads_errored blocker names the errored type", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({
          total: 6,
          ready: 5,
          errored: 1,
          erroredTypes: ["GLOBAL_CASH_FLOW"],
        }),
      }),
    );

    assert.equal(
      pickSpreadStatus(out),
      "warning",
      "errored rows must downgrade category from complete to warning",
    );

    const blocker = out.blockers.find((b) => b.code === "spreads_errored");
    assert.ok(blocker, "must emit spreads_errored blocker");
    assert.equal(blocker!.severity, "warning");
    assert.ok(
      blocker!.title.includes("1 of 6"),
      `errored blocker title must include the ratio ("1 of 6"): got "${blocker!.title}"`,
    );
    assert.ok(
      blocker!.details.join(" ").includes("GLOBAL_CASH_FLOW"),
      "errored blocker details must name the errored spread type",
    );
    assert.ok(
      blocker!.details.join(" ").toLowerCase().includes("re-running"),
      "errored blocker detail must suggest re-running orchestration",
    );
  });

  test("mix: 4 ready + 1 errored + 1 stuck → warning + BOTH blockers", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({
          total: 6,
          ready: 4,
          errored: 1,
          erroredTypes: ["GLOBAL_CASH_FLOW"],
          stuck: 1,
          stuckTypes: ["PERSONAL_FINANCIAL_STATEMENT"],
        }),
      }),
    );

    assert.equal(pickSpreadStatus(out), "warning");

    const stuckBlocker = out.blockers.find((b) => b.code === "spreads_stuck");
    const erroredBlocker = out.blockers.find((b) => b.code === "spreads_errored");
    assert.ok(stuckBlocker, "must emit spreads_stuck blocker when stuck > 0");
    assert.ok(erroredBlocker, "must emit spreads_errored blocker when errored > 0");
    assert.ok(
      erroredBlocker!.details.join(" ").includes("GLOBAL_CASH_FLOW"),
      "errored blocker must list GCF",
    );
    assert.ok(
      stuckBlocker!.details.join(" ").includes("PERSONAL_FINANCIAL_STATEMENT"),
      "stuck blocker must list PFS",
    );
  });

  test("all errored → warning + spreads_errored blocker lists every type", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({
          total: 3,
          ready: 0,
          errored: 3,
          erroredTypes: ["T12", "BALANCE_SHEET", "GLOBAL_CASH_FLOW"],
        }),
      }),
    );

    assert.equal(pickSpreadStatus(out), "warning");

    const blocker = out.blockers.find((b) => b.code === "spreads_errored");
    assert.ok(blocker, "must emit spreads_errored blocker");
    assert.ok(
      blocker!.title.includes("3 of 3"),
      `errored blocker title must include ratio ("3 of 3"): got "${blocker!.title}"`,
    );
    const joined = blocker!.details.join(" ");
    for (const t of ["T12", "BALANCE_SHEET", "GLOBAL_CASH_FLOW"]) {
      assert.ok(joined.includes(t), `errored blocker must list ${t}`);
    }
  });

  test("test-deal shape: 4 ready + 2 errored (GCF, PFS) → warning + errored blocker (V-1 shape)", () => {
    const out = computeReadinessAndBlockers(
      baseInput({
        spreadStats: spreadStats({
          total: 6,
          ready: 4,
          errored: 2,
          erroredTypes: ["GLOBAL_CASH_FLOW", "PERSONAL_FINANCIAL_STATEMENT"],
        }),
      }),
    );

    assert.equal(pickSpreadStatus(out), "warning");

    const blocker = out.blockers.find((b) => b.code === "spreads_errored");
    assert.ok(blocker, "must emit spreads_errored blocker");
    assert.equal(blocker!.title, "Spreads failed to render: 2 of 6");
    assert.deepEqual(
      blocker!.details,
      [
        "Errored spread types: GLOBAL_CASH_FLOW, PERSONAL_FINANCIAL_STATEMENT",
        "These spreads reached a terminal state without succeeding. Re-running orchestration may resolve them.",
      ],
      "V-1 verification shape: spreadBlockers[0].details must match spec exactly",
    );
    assert.equal(blocker!.actionLabel, "");
    assert.equal(blocker!.severity, "warning");
  });
});
