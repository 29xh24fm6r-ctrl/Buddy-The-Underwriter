import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagFromReconciliation } from "../flagFromReconciliation";
import type { FlagEngineInput } from "../types";
import { resetFlagCounter } from "../flagHelpers";

function makeInput(facts: Record<string, unknown> = {}, years: number[] = [2023]): FlagEngineInput {
  resetFlagCounter();
  return {
    deal_id: "deal-1",
    canonical_facts: facts,
    ratios: {},
    years_available: years,
  };
}

describe("flagFromReconciliation", () => {
  // ── Revenue variance ─────────────────────────────────────────────────
  it("flags revenue_variance_3pct when same-year tax vs FS differ > 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      GROSS_RECEIPTS_2023: 1_100_000,
      TOTAL_REVENUE_2023: 1_000_000,
    }));
    const f = flags.find((f) => f.trigger_type === "revenue_variance_3pct");
    assert.ok(f);
    assert.equal(f.severity, "critical");
    assert.equal(f.year_observed, 2023);
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag revenue_variance when within 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      GROSS_RECEIPTS_2023: 1_020_000,
      TOTAL_REVENUE_2023: 1_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "revenue_variance_3pct"));
  });

  // ── Schedule L variance ──────────────────────────────────────────────
  it("flags schedule_l_variance_3pct when > 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      SL_TOTAL_ASSETS_2023: 2_200_000,
      TOTAL_ASSETS_2023: 2_000_000,
    }));
    const f = flags.find((f) => f.trigger_type === "schedule_l_variance_3pct");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag schedule_l_variance when within 3%", () => {
    const flags = flagFromReconciliation(makeInput({
      SL_TOTAL_ASSETS_2023: 2_050_000,
      TOTAL_ASSETS_2023: 2_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "schedule_l_variance_3pct"));
  });

  // ── Retained earnings rollforward ────────────────────────────────────
  it("flags retained_earnings_rollforward_mismatch when > $1000", () => {
    const flags = flagFromReconciliation(makeInput({
      M2_RETAINED_EARNINGS_BEGIN_2023: 500_000,
      M2_NET_INCOME_BOOKS_2023: 100_000,
      M2_DISTRIBUTIONS_2023: 50_000,
      M2_RETAINED_EARNINGS_END_2023: 540_000, // expected 550k, diff = 10k
    }));
    const f = flags.find((f) => f.trigger_type === "retained_earnings_rollforward_mismatch");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
  });

  it("does NOT flag rollforward when within tolerance", () => {
    const flags = flagFromReconciliation(makeInput({
      M2_RETAINED_EARNINGS_BEGIN_2023: 500_000,
      M2_NET_INCOME_BOOKS_2023: 100_000,
      M2_DISTRIBUTIONS_2023: 50_000,
      M2_RETAINED_EARNINGS_END_2023: 550_500, // diff = 500 < 1000
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "retained_earnings_rollforward_mismatch"));
  });

  // ── Large other income ───────────────────────────────────────────────
  it("flags large_other_income_5pct when > 5% of same-year revenue", () => {
    const flags = flagFromReconciliation(makeInput({
      NON_RECURRING_INCOME_2023: 60_000,
      TOTAL_REVENUE_2023: 1_000_000,
    }));
    const f = flags.find((f) => f.trigger_type === "large_other_income_5pct");
    assert.ok(f);
  });

  it("does NOT flag large_other_income when <= 5%", () => {
    const flags = flagFromReconciliation(makeInput({
      NON_RECURRING_INCOME_2023: 40_000,
      TOTAL_REVENUE_2023: 1_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "large_other_income_5pct"));
  });

  // ── Large other expense ──────────────────────────────────────────────
  it("flags large_other_expense_5pct when > 5% of same-year revenue", () => {
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2023: 60_000,
      GROSS_RECEIPTS_2023: 1_000_000, // prefers tax gross receipts as denominator
    }));
    const f = flags.find((f) => f.trigger_type === "large_other_expense_5pct");
    assert.ok(f);
  });

  it("does NOT flag large_other_expense when <= 5%", () => {
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2023: 40_000,
      GROSS_RECEIPTS_2023: 1_000_000,
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "large_other_expense_5pct"));
  });

  // ── Empty facts ──────────────────────────────────────────────────────
  it("returns empty array for empty facts", () => {
    const flags = flagFromReconciliation(makeInput());
    assert.equal(flags.length, 0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // SPEC-RISK-FLAG-PERIOD-ALIGNED-RECONCILIATION-1 — Omnicare regression
  // ══════════════════════════════════════════════════════════════════════

  it("REGRESSION: does NOT create 359% revenue variance from 2024 tax vs 2026 YTD", () => {
    // Omnicare 365: 2024 full-year tax return + 2026 Q1 YTD income statement
    const flags = flagFromReconciliation(makeInput({
      // 2024 tax return
      GROSS_RECEIPTS_2024: 29_013_467,
      OTHER_DEDUCTIONS_2024: 2_340_232,
      // 2025 full-year income statement
      TOTAL_REVENUE_2025: 25_861_373.14,
      // 2026 Q1 YTD income statement
      TOTAL_REVENUE_2026: 6_317_223.94,
      // Generic keys (last-writer-wins from buildFlagEngineInput)
      GROSS_RECEIPTS: 29_013_467,
      OTHER_DEDUCTIONS: 2_340_232,
      TOTAL_REVENUE: 6_317_223.94,
    }, [2024, 2025, 2026]));

    // Must NOT flag revenue_variance from cross-period comparison
    const revenueFlag = flags.find((f) => f.trigger_type === "revenue_variance_3pct");
    assert.ok(
      !revenueFlag,
      "Must not create revenue_variance_3pct from 2024 tax ($29M) vs 2026 YTD ($6.3M) — different periods",
    );
  });

  it("REGRESSION: other deductions uses 2024 tax gross receipts as denominator, not 2026 YTD", () => {
    const flags = flagFromReconciliation(makeInput({
      GROSS_RECEIPTS_2024: 29_013_467,
      OTHER_DEDUCTIONS_2024: 2_340_232,
      TOTAL_REVENUE_2026: 6_317_223.94,
      GROSS_RECEIPTS: 29_013_467,
      OTHER_DEDUCTIONS: 2_340_232,
      TOTAL_REVENUE: 6_317_223.94,
    }, [2024, 2026]));

    const expenseFlag = flags.find(
      (f) => f.trigger_type === "large_other_expense_5pct" && f.year_observed === 2024,
    );
    assert.ok(expenseFlag, "Should flag 2024 other deductions against 2024 gross receipts");
    // $2,340,232 / $29,013,467 ≈ 8.1%, not 37.0%
    assert.ok(
      expenseFlag.banker_detail?.includes("29,013,467"),
      "Denominator must be 2024 tax gross receipts ($29M), not 2026 YTD revenue ($6.3M)",
    );
    assert.ok(
      !expenseFlag.banker_detail?.includes("37.0%"),
      "Percentage must be ~8.1%, not 37.0% (wrong cross-period denominator)",
    );
  });

  it("REGRESSION: no reconciliation flag compares different-year facts", () => {
    // Only 2024 tax data, no 2024 financial statement → no same-year revenue comparison possible
    const flags = flagFromReconciliation(makeInput({
      GROSS_RECEIPTS_2024: 29_013_467,
      TOTAL_REVENUE_2025: 25_861_373.14,
    }, [2024, 2025]));

    const revenueFlag = flags.find((f) => f.trigger_type === "revenue_variance_3pct");
    assert.ok(
      !revenueFlag,
      "Must not compare 2024 GROSS_RECEIPTS to 2025 TOTAL_REVENUE",
    );
  });
});
