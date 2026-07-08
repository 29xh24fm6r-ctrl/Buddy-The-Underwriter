/**
 * SPEC-CURRENT-STAGE-AUDIT-FIX-2 — credit-safety interpretation & ratio guards.
 *
 * Asserts the Tier-4 fixes from the finengine audit:
 *  - a NEGATIVE leverage/solvency ratio (negative EBITDA / negative equity) rates "flag", never
 *    "strong" (distress must not read as strength);
 *  - net-debt ratios keep their normal band behavior when negative (net-cash is not distress);
 *  - net working capital returns N/A when a component is missing (no missing→0 overstatement);
 *  - the cash ratio is a diagnostic (no quick-ratio floor misapplied);
 *  - the PD/risk-rating leverage overlay penalizes negative leverage.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { interpret } from "@/lib/finengine/metrics/interpret";
import { netWorkingCapital, cashRatio } from "@/lib/finengine/metrics/balanceSheet";
import { computePD, type ObligorSignals } from "@/lib/finengine/riskRating";

// ── Negative-denominator leverage/solvency: distress must NOT rate strong ──────

test("LEVERAGE_TOTAL negative (negative EBITDA) rates 'flag', not 'strong'", () => {
  assert.equal(interpret({ metric: "LEVERAGE_TOTAL", value: -2 }).rating, "flag");
});

test("DEBT_TO_EQUITY negative (negative equity) rates 'flag'", () => {
  assert.equal(interpret({ metric: "DEBT_TO_EQUITY", value: -1.5 }).rating, "flag");
});

test("EQUITY_MULTIPLIER negative (negative equity) rates 'flag'", () => {
  assert.equal(interpret({ metric: "EQUITY_MULTIPLIER", value: -3 }).rating, "flag");
});

test("LEVERAGE_TOTAL healthy positive still rates 'strong' (no regression)", () => {
  assert.equal(interpret({ metric: "LEVERAGE_TOTAL", value: 1.5 }).rating, "strong");
});

test("LEVERAGE_TOTAL high positive still rates 'flag' (no regression)", () => {
  assert.equal(interpret({ metric: "LEVERAGE_TOTAL", value: 10 }).rating, "flag");
});

test("LEVERAGE_TOTAL_NET negative is NOT forced to flag (net-cash is not distress)", () => {
  // Net-debt metrics are intentionally NOT marked flagWhenNegative — a negative value can mean a
  // net-cash position, which is favorable. It must retain normal band behavior.
  assert.notEqual(interpret({ metric: "LEVERAGE_TOTAL_NET", value: -1 }).rating, "flag");
});

// ── Net working capital: missing input must be N/A, not treated as $0 ──────────

test("netWorkingCapital returns null when current liabilities are MISSING", () => {
  assert.equal(netWorkingCapital(500_000, null).value, null);
});

test("netWorkingCapital returns null when current assets are MISSING", () => {
  assert.equal(netWorkingCapital(null, 200_000).value, null);
});

test("netWorkingCapital computes the real difference when both present", () => {
  assert.equal(netWorkingCapital(500_000, 200_000).value, 300_000);
});

test("netWorkingCapital allows an explicit zero component", () => {
  assert.equal(netWorkingCapital(500_000, 0).value, 500_000);
});

// ── Cash ratio: diagnostic value, not graded against the quick-ratio floor ─────

test("cashRatio returns the plain cash/current-liabilities value (diagnostic)", () => {
  assert.equal(cashRatio(100_000, 200_000).value, 0.5);
});

// ── Risk rating: negative leverage must trigger the leverage penalty ───────────

test("computePD penalizes negative leverage with an explicit driver", () => {
  const base: ObligorSignals = { dscr: 1.5, leverage: null };
  const negLev: ObligorSignals = { dscr: 1.5, leverage: -2 };
  const baseRes = computePD(base);
  const negRes = computePD(negLev);
  assert.ok(
    negRes.drivers.some((d) => /negative leverage/i.test(d)),
    "expected a negative-leverage driver",
  );
  assert.ok(
    negRes.grade > baseRes.grade,
    `negative leverage should worsen the grade (base=${baseRes.grade}, neg=${negRes.grade})`,
  );
});
