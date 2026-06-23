/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-1 — CI Guard Tests
 *
 * Guards:
 * 1. OD detail key schema exists with category definitions
 * 2. Question is targeted (not generic) when OD detail facts exist
 * 3. Question asks for breakdown when OD detail is missing
 * 4. Detail-sum reconciliation flag fires on mismatch
 * 5. Detail-sum reconciliation does not fire within $1 tolerance
 * 6. Omnicare 2024: question uses correct denominator and no 37.0%
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateQuestion } from "../questionGenerator";
import { flagFromReconciliation } from "../flagFromReconciliation";
import { buildFlag, resetFlagCounter } from "../flagHelpers";
import { getRule } from "../flagRegistry";
import type { FlagEngineInput } from "../types";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

function makeFlag(triggerType: string, observedValue: number, yearObserved: number) {
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
    bankerSummary: "Test",
    bankerDetail: "Test",
    bankerImplication: "Test",
    borrowerQuestion: null,
  });
}

function makeInput(facts: Record<string, unknown>, years: number[]): FlagEngineInput {
  resetFlagCounter();
  return { deal_id: "deal-1", canonical_facts: facts, ratios: {}, years_available: years };
}

const OD_KEYS_SRC = read("src/lib/financialSpreads/extractors/otherDeductionsDetailKeys.ts");

describe("SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-1 guards", () => {

  test("Guard 1: OD detail key schema defines categories and summary keys", () => {
    assert.match(OD_KEYS_SRC, /OD_CATEGORIES/, "Must define OD_CATEGORIES");
    assert.match(OD_KEYS_SRC, /RELATED_PARTY_PAYMENTS/, "Must include related-party category");
    assert.match(OD_KEYS_SRC, /MANAGEMENT_FEES/, "Must include management fees category");
    assert.match(OD_KEYS_SRC, /OD_SUMMARY_KEYS/, "Must define summary fact keys");
    assert.match(OD_KEYS_SRC, /OD_HIGH_RISK_CATEGORIES/, "Must define high-risk categories");
    assert.match(OD_KEYS_SRC, /OD_POTENTIAL_ADDBACK_CATEGORIES/, "Must define potential add-back categories");
  });

  test("Guard 2: targeted question when OD detail exists with high-risk items", () => {
    const flag = makeFlag("large_other_expense_5pct", 2_340_232, 2024);
    const q = generateQuestion(flag, {
      GROSS_RECEIPTS_2024: 29_013_467,
      OD_DETAIL_TOTAL_2024: 2_340_232,
      OD_DETAIL_RELATED_PARTY_TOTAL_2024: 500_000,
      OD_DETAIL_CONSULTING_2024: 300_000,
    });
    assert.ok(q, "Question should be generated for targeted review");
    assert.ok(q.question_text.includes("related-party"), "Must mention related-party items");
    assert.ok(q.question_text.includes("consulting"), "Must mention consulting fees");
    assert.ok(!q.question_text.includes("provide a breakdown"), "Must NOT ask for generic breakdown");
    assert.ok(!q.question_text.includes("Could you provide the attached"), "Must NOT ask for the statement");
  });

  test("Guard 3: generic breakdown question when OD detail is missing", () => {
    const flag = makeFlag("large_other_expense_5pct", 2_340_232, 2024);
    const q = generateQuestion(flag, {
      GROSS_RECEIPTS_2024: 29_013_467,
      // no OD_DETAIL_TOTAL_2024 — detail not extracted
    });
    assert.ok(q, "Question should still be generated");
    assert.ok(
      q.question_text.includes("breakdown") || q.question_text.includes("attached statement"),
      "Must ask for breakdown when detail is missing",
    );
    assert.ok(q.document_requested, "Must request document when detail missing");
  });

  test("Guard 4: detail-sum reconciliation flag on mismatch", () => {
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2024: 2_340_232,
      OD_DETAIL_TOTAL_2024: 2_100_000, // $240K mismatch
      GROSS_RECEIPTS_2024: 29_000_000,
    }, [2024]));
    const mismatch = flags.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch");
    assert.ok(mismatch, "Must create mismatch flag when detail sum differs from aggregate");
    assert.equal(mismatch.year_observed, 2024);
  });

  test("Guard 5: no mismatch flag within $1 tolerance", () => {
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2024: 2_340_232,
      OD_DETAIL_TOTAL_2024: 2_340_231.50, // < $1 difference
      GROSS_RECEIPTS_2024: 29_000_000,
    }, [2024]));
    const mismatch = flags.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch");
    assert.ok(!mismatch, "Must NOT flag when difference is within $1 rounding tolerance");
  });

  test("Guard 6: Omnicare 2024 — correct denominator and no 37.0%", () => {
    const flag = makeFlag("large_other_expense_5pct", 2_340_232, 2024);
    const q = generateQuestion(flag, {
      GROSS_RECEIPTS_2024: 29_013_467,
      TOTAL_REVENUE_2026: 6_317_223.94,
    });
    assert.ok(q, "Question should be generated");
    assert.ok(q.question_text.includes("2024"), "Must reference 2024 tax year");
    assert.ok(!q.question_text.includes("37.0%"), "Must NOT show 37.0% (wrong cross-period denominator)");
    assert.ok(!q.question_text.includes("2026"), "Must NOT reference 2026 in the question");
  });
});
