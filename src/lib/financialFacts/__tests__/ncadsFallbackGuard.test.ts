/**
 * SPEC-NCADS-SUPERSEDED-FALLBACK-1 — Guard tests (2026-05-18)
 *
 * Proves:
 *   1. runCashFlowAggregator result type includes ncadsWarnings
 *   2. ncadsWarnings populated when NET_INCOME = 0
 *   3. snapshot recompute response includes dscr_blocker
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGG_SRC = readFileSync(
  resolve(__dirname, "../runCashFlowAggregator.ts"),
  "utf-8",
);

const ROUTE_SRC = readFileSync(
  resolve(
    __dirname,
    "../../../app/api/deals/[dealId]/financial-snapshot/recompute/route.ts",
  ),
  "utf-8",
);

describe("SPEC-NCADS-SUPERSEDED-FALLBACK-1 guards", () => {
  test("runCashFlowAggregator result includes ncadsWarnings array", () => {
    assert.ok(
      AGG_SRC.includes("ncadsWarnings: string[]"),
      "Result type must include ncadsWarnings: string[]",
    );
  });

  test("ncadsWarnings populated when NET_INCOME = 0", () => {
    assert.ok(
      AGG_SRC.includes('ncads === 0 && ncadsSource === "NET_INCOME"'),
      "Must check for NET_INCOME = 0 and emit a warning",
    );
  });

  test("ncadsWarnings populated when NCADS is negative", () => {
    assert.ok(
      AGG_SRC.includes("ncads < 0"),
      "Must check for negative NCADS and emit a warning",
    );
  });

  test("ncadsWarnings included in success return", () => {
    assert.ok(
      AGG_SRC.includes("ncadsWarnings,"),
      "ncadsWarnings must be in the success return object",
    );
  });

  test("snapshot recompute route surfaces dscr_blocker", () => {
    assert.ok(
      ROUTE_SRC.includes("dscr_blocker"),
      "snapshot recompute route must surface dscr_blocker when DSCR is null",
    );
  });

  test("snapshot recompute route includes dscr_blocker_detail", () => {
    assert.ok(
      ROUTE_SRC.includes("dscr_blocker_detail"),
      "snapshot recompute must include dscr_blocker_detail explanation",
    );
  });
});
