import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagFromQoE } from "../flagFromQoE";
import type { FlagEngineInput } from "../types";
import type { QualityOfEarningsReport } from "../../spreads/qoeEngine";
import { resetFlagCounter } from "../flagHelpers";

function makeInput(
  qoe?: QualityOfEarningsReport,
  facts: Record<string, unknown> = {},
): FlagEngineInput {
  resetFlagCounter();
  return {
    deal_id: "deal-1",
    canonical_facts: facts,
    ratios: {},
    years_available: [2023],
    qoe_report: qoe,
  };
}

function makeQoE(overrides: Partial<QualityOfEarningsReport> = {}): QualityOfEarningsReport {
  return {
    reportedEbitda: 500_000,
    adjustedEbitda: 480_000,
    adjustmentTotal: -20_000,
    confidence: "high",
    adjustments: [],
    ...overrides,
  };
}

describe("flagFromQoE", () => {
  // ── No QoE report ──────────────────────────────────────────────────────
  it("returns empty array when no qoe_report provided", () => {
    const flags = flagFromQoE(makeInput());
    assert.equal(flags.length, 0);
  });

  // ── Low confidence ─────────────────────────────────────────────────────
  it("flags qoe_adjustment_low_confidence when confidence is low", () => {
    const flags = flagFromQoE(makeInput(makeQoE({ confidence: "low" })));
    const f = flags.find((f) => f.trigger_type === "qoe_adjustment_low_confidence");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
  });

  it("does NOT flag low confidence when confidence is high", () => {
    const flags = flagFromQoE(makeInput(makeQoE({ confidence: "high" })));
    assert.ok(!flags.some((f) => f.trigger_type === "qoe_adjustment_low_confidence"));
  });

  // ── ERC credit ─────────────────────────────────────────────────────────
  it("flags erc_credit_excluded when adjustment line mentions ERC", () => {
    const flags = flagFromQoE(makeInput(makeQoE({
      adjustments: [{
        lineItem: "Employee Retention Credit",
        amount: 75_000,
        direction: "deduct",
        classification: "non_recurring_income",
        source: "tax_return",
        documentationRequired: false,
        autoApproved: true,
      }],
    })));
    const f = flags.find((f) => f.trigger_type === "erc_credit_excluded");
    assert.ok(f);
    assert.ok(f.banker_summary.includes("$75,000"));
  });

  it("does NOT flag erc when no ERC adjustment present", () => {
    const flags = flagFromQoE(makeInput(makeQoE({
      adjustments: [{
        lineItem: "Owner compensation above market",
        amount: 50_000,
        direction: "add_back",
        classification: "owner_benefit",
        source: "financial_statements",
        documentationRequired: false,
        autoApproved: true,
      }],
    })));
    assert.ok(!flags.some((f) => f.trigger_type === "erc_credit_excluded"));
  });

  // ── Non-recurring income ───────────────────────────────────────────────
  it("flags nonrecurring_income_present for non_recurring_income classification", () => {
    const flags = flagFromQoE(makeInput(makeQoE({
      adjustments: [{
        lineItem: "Gain on sale of equipment",
        amount: 30_000,
        direction: "deduct",
        classification: "non_recurring_income",
        source: "financial_statements",
        documentationRequired: true,
        autoApproved: false,
      }],
    })));
    const f = flags.find((f) => f.trigger_type === "nonrecurring_income_present");
    assert.ok(f);
  });

  it("does NOT flag nonrecurring_income for zero-amount items", () => {
    const flags = flagFromQoE(makeInput(makeQoE({
      adjustments: [{
        lineItem: "Gain reversal",
        amount: 0,
        direction: "deduct",
        classification: "non_recurring_income",
        source: "financial_statements",
        documentationRequired: false,
        autoApproved: true,
      }],
    })));
    assert.ok(!flags.some((f) => f.trigger_type === "nonrecurring_income_present"));
  });

  // ── Total adjustments > 20% ────────────────────────────────────────────
  it("flags qoe_total_adjustments_exceed_20pct when adjustments > 20% of EBITDA", () => {
    const flags = flagFromQoE(makeInput(makeQoE({
      reportedEbitda: 500_000,
      adjustmentTotal: -150_000, // 30% of reported
      adjustedEbitda: 350_000,
    })));
    const f = flags.find((f) => f.trigger_type === "qoe_total_adjustments_exceed_20pct");
    assert.ok(f);
    assert.equal(f.severity, "critical");
  });

  it("does NOT flag total adjustments when <= 20%", () => {
    const flags = flagFromQoE(makeInput(makeQoE({
      reportedEbitda: 500_000,
      adjustmentTotal: -50_000, // 10%
      adjustedEbitda: 450_000,
    })));
    assert.ok(!flags.some((f) => f.trigger_type === "qoe_total_adjustments_exceed_20pct"));
  });

  it("does NOT flag total adjustments when reportedEbitda is zero", () => {
    const flags = flagFromQoE(makeInput(makeQoE({
      reportedEbitda: 0,
      adjustmentTotal: -50_000,
      adjustedEbitda: -50_000,
    })));
    assert.ok(!flags.some((f) => f.trigger_type === "qoe_total_adjustments_exceed_20pct"));
  });
});
