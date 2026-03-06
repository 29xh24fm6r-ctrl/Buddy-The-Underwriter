import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateQuestion } from "../questionGenerator";
import { buildFlag, resetFlagCounter } from "../flagHelpers";
import { getRule } from "../flagRegistry";

function makeFlag(triggerType: string, observedValue: number | string | null = null, yearObserved?: number) {
  resetFlagCounter();
  const rule = getRule(triggerType);
  return buildFlag({
    dealId: "deal-1",
    triggerType,
    category: rule?.category ?? "financial_irregularity",
    severity: rule?.default_severity ?? "elevated",
    canonicalKeys: rule?.canonical_keys_involved ?? [],
    observedValue,
    yearObserved,
    bankerSummary: "Test summary",
    bankerDetail: "Test detail",
    bankerImplication: "Test implication",
    borrowerQuestion: null,
  });
}

describe("questionGenerator", () => {
  // ── Template substitution with real numbers ────────────────────────────
  it("revenue_variance_3pct includes dollar amounts from facts", () => {
    const flag = makeFlag("revenue_variance_3pct", 1_100_000, 2023);
    const q = generateQuestion(flag, {
      GROSS_RECEIPTS: 1_100_000,
      TOTAL_REVENUE: 1_000_000,
    });
    assert.ok(q.question_text.includes("$1,100,000"));
    assert.ok(q.question_text.includes("$1,000,000"));
    assert.ok(q.question_text.includes("$100,000"));
    assert.ok(q.question_text.includes("2023"));
  });

  it("dscr_below_1x includes the DSCR value", () => {
    const flag = makeFlag("dscr_below_1x", 0.85, 2023);
    const q = generateQuestion(flag, { DSCR: 0.85 });
    assert.ok(q.question_text.includes("0.85x"));
    assert.ok(q.question_text.includes("2023"));
  });

  it("dso_above_90 requests an AR aging report", () => {
    const flag = makeFlag("dso_above_90", 120, 2023);
    const q = generateQuestion(flag, { DSO: 120 });
    assert.ok(q.question_text.includes("120"));
    assert.equal(q.document_requested, "Current accounts receivable aging report");
    assert.equal(q.document_format, "PDF or Excel");
  });

  it("k1_orphan_entity requests entity tax returns", () => {
    const flag = makeFlag("k1_orphan_entity", 50_000, 2023);
    const q = generateQuestion(flag, {
      K1_ORDINARY_INCOME: 50_000,
      K1_ENTITY_NAME: "ABC Holdings LLC",
    });
    assert.ok(q.question_text.includes("$50,000"));
    assert.ok(q.question_text.includes("ABC Holdings LLC"));
    assert.ok(q.document_requested?.includes("ABC Holdings LLC"));
  });

  it("lease_expiring_within_loan_term includes dates", () => {
    const flag = makeFlag("lease_expiring_within_loan_term", "2026-06-01", 2023);
    const q = generateQuestion(flag, {
      lease_expiration_date: "2026-06-01",
      loan_maturity_date: "2028-12-31",
    });
    assert.ok(q.question_text.includes("2026-06-01"));
    assert.ok(q.question_text.includes("2028-12-31"));
    assert.ok(q.document_requested?.includes("Lease"));
  });

  it("schedule_e_missing requests the schedule", () => {
    const flag = makeFlag("schedule_e_missing", 36_000, 2023);
    const q = generateQuestion(flag, {});
    assert.ok(q.document_requested?.includes("Schedule E"));
    assert.equal(q.document_format, "PDF");
  });

  // ── Urgency resolution ─────────────────────────────────────────────────
  it("critical triggers get required_before_approval urgency", () => {
    const flag = makeFlag("dscr_below_1x", 0.85, 2023);
    const q = generateQuestion(flag, {});
    assert.equal(q.document_urgency, "required_before_approval");
  });

  it("closing triggers get required_before_closing urgency", () => {
    const flag = makeFlag("lease_expiring_within_loan_term", "2026-06-01", 2023);
    const q = generateQuestion(flag, {});
    assert.equal(q.document_urgency, "required_before_closing");
  });

  it("non-critical triggers get preferred urgency", () => {
    const flag = makeFlag("dscr_two_year_decline", null, 2023);
    const q = generateQuestion(flag, {});
    assert.equal(q.document_urgency, "preferred");
  });

  // ── 400-char length checks ─────────────────────────────────────────────
  it("all template questions are under 400 characters", () => {
    const triggerTypes = [
      "dscr_below_1x", "dscr_below_policy_minimum", "dscr_two_year_decline",
      "fccr_below_1x", "debt_ebitda_above_5x", "dso_above_90",
      "current_ratio_below_1x", "gross_margin_compressed_500bps",
      "revenue_declining_10pct", "revenue_growing_margin_compressing",
      "cash_conversion_cycle_above_90",
      "revenue_variance_3pct", "schedule_l_variance_3pct",
      "retained_earnings_rollforward_mismatch", "k1_orphan_entity",
      "large_other_income_5pct", "large_other_expense_5pct",
      "qoe_adjustment_low_confidence", "qoe_total_adjustments_exceed_20pct",
      "nonrecurring_income_present",
      "ebitda_margin_declining_2yr", "revenue_declining_2yr", "working_capital_deteriorating",
      "lease_expiring_within_loan_term", "customer_concentration_25pct",
      "provider_concentration_80pct", "undisclosed_contingent_liability",
      "ydt_financials_stale_90_days", "schedule_e_missing",
      "personal_financial_statement_stale", "rent_roll_missing",
      "construction_budget_missing", "dso_increasing_15_days",
    ];
    for (const tt of triggerTypes) {
      const flag = makeFlag(tt, 100_000, 2023);
      const q = generateQuestion(flag, {
        GROSS_RECEIPTS: 1_100_000,
        TOTAL_REVENUE: 1_000_000,
        SL_TOTAL_ASSETS: 2_200_000,
        TOTAL_ASSETS: 2_000_000,
        K1_ORDINARY_INCOME: 50_000,
        K1_ENTITY_NAME: "Test LLC",
        lease_expiration_date: "2026-06-01",
        loan_maturity_date: "2028-12-31",
        pfs_contingent_liability_amount: 250_000,
        ytd_statement_date: "2025-06-30",
        pfs_date: "2025-01-15",
      });
      assert.ok(
        q.question_text.length <= 400,
        `${tt} question is ${q.question_text.length} chars (max 400): "${q.question_text.slice(0, 80)}..."`,
      );
    }
  });

  // ── Fallback generic question ──────────────────────────────────────────
  it("generates fallback question for unknown trigger types", () => {
    const flag = makeFlag("unknown_trigger_xyz", 42, 2023);
    const q = generateQuestion(flag, {});
    assert.ok(q.question_text.includes("clarification"));
    assert.ok(q.question_id.startsWith("q_"));
  });
});
