import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagFromRatios } from "../flagFromRatios";
import type { FlagEngineInput } from "../types";
import { resetFlagCounter } from "../flagHelpers";

function makeInput(overrides: Partial<FlagEngineInput> = {}): FlagEngineInput {
  resetFlagCounter();
  return {
    deal_id: "deal-1",
    canonical_facts: {},
    ratios: {},
    years_available: [2023],
    ...overrides,
  };
}

describe("flagFromRatios", () => {
  // ── DSCR ──────────────────────────────────────────────────────────────
  it("flags dscr_below_1x when DSCR < 1.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DSCR: 0.85 } }));
    const f = flags.find((f) => f.trigger_type === "dscr_below_1x");
    assert.ok(f, "dscr_below_1x flag should exist");
    assert.equal(f.severity, "critical");
    assert.ok(f.banker_summary.length > 0);
    assert.ok(f.banker_summary.includes("0.85"));
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag dscr_below_1x when DSCR >= 1.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DSCR: 1.30 } }));
    assert.ok(!flags.some((f) => f.trigger_type === "dscr_below_1x"));
  });

  it("flags dscr_below_policy_minimum when 1.0 <= DSCR < 1.25", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DSCR: 1.10 } }));
    const f = flags.find((f) => f.trigger_type === "dscr_below_policy_minimum");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag dscr_below_policy_minimum when DSCR >= 1.25", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DSCR: 1.30 } }));
    assert.ok(!flags.some((f) => f.trigger_type === "dscr_below_policy_minimum"));
  });

  it("flags dscr_proximity when DSCR is within 10% of policy min", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DSCR: 1.30 } }));
    const f = flags.find((f) => f.trigger_type === "dscr_proximity_within_10pct");
    assert.ok(f, "proximity flag should fire for 1.30 (within 10% of 1.25)");
    assert.equal(f.severity, "watch");
    assert.equal(f.borrower_question, null);
  });

  // ── FCCR ──────────────────────────────────────────────────────────────
  it("flags fccr_below_1x when FCCR < 1.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { FCCR: 0.90 } }));
    const f = flags.find((f) => f.trigger_type === "fccr_below_1x");
    assert.ok(f);
    assert.equal(f.severity, "critical");
  });

  it("does NOT flag fccr_below_1x when FCCR >= 1.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { FCCR: 1.20 } }));
    assert.ok(!flags.some((f) => f.trigger_type === "fccr_below_1x"));
  });

  // ── Debt/EBITDA ──────────────────────────────────────────────────────
  it("flags debt_ebitda_above_5x when > 5.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DEBT_TO_EBITDA: 5.5 } }));
    const f = flags.find((f) => f.trigger_type === "debt_ebitda_above_5x");
    assert.ok(f);
    assert.equal(f.severity, "critical");
    assert.ok(f.borrower_question !== null);
  });

  it("flags debt_ebitda_above_4x (watch) when 4 < ratio <= 5", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DEBT_TO_EBITDA: 4.3 } }));
    const f = flags.find((f) => f.trigger_type === "debt_ebitda_above_4x");
    assert.ok(f);
    assert.equal(f.severity, "watch");
    assert.equal(f.borrower_question, null);
  });

  it("does NOT flag debt_ebitda when <= 4.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DEBT_TO_EBITDA: 3.5 } }));
    assert.ok(!flags.some((f) => f.trigger_type === "debt_ebitda_above_5x"));
    assert.ok(!flags.some((f) => f.trigger_type === "debt_ebitda_above_4x"));
  });

  // ── DSO ───────────────────────────────────────────────────────────────
  it("flags dso_above_90 when DSO > 90", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DSO: 105 } }));
    const f = flags.find((f) => f.trigger_type === "dso_above_90");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
    assert.ok(f.borrower_question !== null);
  });

  it("does NOT flag dso_above_90 when DSO <= 90", () => {
    const flags = flagFromRatios(makeInput({ ratios: { DSO: 45 } }));
    assert.ok(!flags.some((f) => f.trigger_type === "dso_above_90"));
  });

  // ── Current ratio ────────────────────────────────────────────────────
  it("flags current_ratio_below_1x when < 1.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { CURRENT_RATIO: 0.75 } }));
    const f = flags.find((f) => f.trigger_type === "current_ratio_below_1x");
    assert.ok(f);
    assert.equal(f.severity, "critical");
  });

  it("does NOT flag current_ratio_below_1x when >= 1.0", () => {
    const flags = flagFromRatios(makeInput({ ratios: { CURRENT_RATIO: 1.50 } }));
    assert.ok(!flags.some((f) => f.trigger_type === "current_ratio_below_1x"));
  });

  // ── LTV ──────────────────────────────────────────────────────────────
  it("flags ltv_above_80 when > 0.80", () => {
    const flags = flagFromRatios(makeInput({ ratios: { LTV: 0.85 } }));
    const f = flags.find((f) => f.trigger_type === "ltv_above_80");
    assert.ok(f);
    assert.equal(f.severity, "critical");
    assert.equal(f.borrower_question, null); // banker only
  });

  it("does NOT flag ltv_above_80 when <= 0.80", () => {
    const flags = flagFromRatios(makeInput({ ratios: { LTV: 0.70 } }));
    assert.ok(!flags.some((f) => f.trigger_type === "ltv_above_80"));
  });

  // ── Revenue decline ─────────────────────────────────────────────────
  it("flags revenue_declining_10pct when revenue drops > 10%", () => {
    const flags = flagFromRatios(makeInput({
      ratios: {},
      canonical_facts: { TOTAL_REVENUE: 900_000, TOTAL_REVENUE_PRIOR: 1_100_000 },
    }));
    const f = flags.find((f) => f.trigger_type === "revenue_declining_10pct");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
  });

  it("does NOT flag revenue_declining_10pct when decline < 10%", () => {
    const flags = flagFromRatios(makeInput({
      canonical_facts: { TOTAL_REVENUE: 950_000, TOTAL_REVENUE_PRIOR: 1_000_000 },
    }));
    assert.ok(!flags.some((f) => f.trigger_type === "revenue_declining_10pct"));
  });

  // ── CCC ──────────────────────────────────────────────────────────────
  it("flags cash_conversion_cycle_above_90 when CCC > 90", () => {
    const flags = flagFromRatios(makeInput({
      ratios: { CCC: 110, DSO: 50, DIO: 80, DPO: 20 },
    }));
    const f = flags.find((f) => f.trigger_type === "cash_conversion_cycle_above_90");
    assert.ok(f);
    assert.equal(f.severity, "watch");
  });

  // ── Empty ratios produce no flags ────────────────────────────────────
  it("returns empty array for empty ratios and facts", () => {
    const flags = flagFromRatios(makeInput());
    assert.equal(flags.length, 0);
  });
});
