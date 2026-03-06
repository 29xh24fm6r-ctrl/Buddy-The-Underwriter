import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagFromReconciliation } from "../flagFromReconciliation";
import type { FlagEngineInput } from "../types";
import { resetFlagCounter } from "../flagHelpers";

function makeInput(facts: Record<string, unknown> = {}): FlagEngineInput {
  resetFlagCounter();
  return {
    deal_id: "deal-1",
    canonical_facts: facts,
    ratios: {},
    years_available: [2023],
  };
}

describe("flagFromReconciliation", () => {
  // ── Revenue variance ─────────────────────────────────────────────────
  it("flags revenue_variance_3pct when tax vs FS differ > 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      GROSS_RECEIPTS: 1_100_000,
      TOTAL_REVENUE: 1_000_000,
    }));
    const f = flags.find((f) => f.trigger_type === "revenue_variance_3pct");
    assert.ok(f);
    assert.equal(f.severity, "critical");
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag revenue_variance when within 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      GROSS_RECEIPTS: 1_020_000,
      TOTAL_REVENUE: 1_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "revenue_variance_3pct"));
  });

  // ── Schedule L variance ──────────────────────────────────────────────
  it("flags schedule_l_variance_3pct when > 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      SL_TOTAL_ASSETS: 2_200_000,
      TOTAL_ASSETS: 2_000_000,
    }));
    const f = flags.find((f) => f.trigger_type === "schedule_l_variance_3pct");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag schedule_l_variance when within 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      SL_TOTAL_ASSETS: 2_050_000,
      TOTAL_ASSETS: 2_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "schedule_l_variance_3pct"));
  });

  // ── Retained earnings rollforward ────────────────────────────────────
  it("flags retained_earnings_rollforward_mismatch when > $1000", () => {
    const flags = flagFromReconciliation(makeInput({
      M2_RETAINED_EARNINGS_BEGIN: 500_000,
      M2_NET_INCOME_BOOKS: 100_000,
      M2_DISTRIBUTIONS: 50_000,
      M2_RETAINED_EARNINGS_END: 540_000, // expected 550k, diff = 10k
    }));
    const f = flags.find((f) => f.trigger_type === "retained_earnings_rollforward_mismatch");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
  });

  it("does NOT flag rollforward when within tolerance", () => {
    const flags = flagFromReconciliation(makeInput({
      M2_RETAINED_EARNINGS_BEGIN: 500_000,
      M2_NET_INCOME_BOOKS: 100_000,
      M2_DISTRIBUTIONS: 50_000,
      M2_RETAINED_EARNINGS_END: 550_500, // diff = 500 < 1000
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "retained_earnings_rollforward_mismatch"));
  });

  // ── Large other income ───────────────────────────────────────────────
  it("flags large_other_income_5pct when > 5% of revenue", () => {
    const flags = flagFromReconciliation(makeInput({
      NON_RECURRING_INCOME: 60_000,
      TOTAL_REVENUE: 1_000_000,
    }));
    const f = flags.find((f) => f.trigger_type === "large_other_income_5pct");
    assert.ok(f);
  });

  it("does NOT flag large_other_income when <= 5%", () => {
    const flags = flagFromReconciliation(makeInput({
      NON_RECURRING_INCOME: 40_000,
      TOTAL_REVENUE: 1_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "large_other_income_5pct"));
  });

  // ── Large other expense ──────────────────────────────────────────────
  it("flags large_other_expense_5pct when > 5% of revenue", () => {
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS: 60_000,
      TOTAL_REVENUE: 1_000_000,
    }));
    const f = flags.find((f) => f.trigger_type === "large_other_expense_5pct");
    assert.ok(f);
  });

  it("does NOT flag large_other_expense when <= 5%", () => {
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS: 40_000,
      TOTAL_REVENUE: 1_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "large_other_expense_5pct"));
  });

  // ── Empty facts ──────────────────────────────────────────────────────
  it("returns empty array for empty facts", () => {
    const flags = flagFromReconciliation(makeInput());
    assert.equal(flags.length, 0);
  });
});
