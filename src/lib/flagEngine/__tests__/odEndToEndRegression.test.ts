/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-6
 *
 * End-to-end regression harness proving the full OD chain:
 *   extraction → flag → question → banker review → memo → NCADS/DSCR
 *
 * Three fixtures:
 * 1. Happy path: detail extracted, banker marks addback, memo + DSCR agree
 * 2. Missing detail: generic document request, no NCADS adjustment
 * 3. Unreconciled detail: mismatch flag, memo notes variance, only approved lines adjust
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Imports: each layer of the chain ──
import { extractOtherDeductionsDetail } from "../../financialSpreads/extractors/deterministic/otherDeductionsDetailDeterministic";
import { flagFromReconciliation } from "../flagFromReconciliation";
import { generateQuestion } from "../questionGenerator";
import { buildOdNormalizedEarningsAdjustments } from "../../financialFacts/buildOdNormalizedEarningsAdjustments";
import { buildOdNormalizationNarrative } from "../../creditMemo/canonical/buildOdNormalizationNarrative";
import { buildFlag, resetFlagCounter } from "../flagHelpers";
import { getRule } from "../flagRegistry";
import type { FlagEngineInput } from "../types";

function makeInput(facts: Record<string, unknown>, years: number[]): FlagEngineInput {
  resetFlagCounter();
  return { deal_id: "deal-e2e", canonical_facts: facts, ratios: {}, years_available: years };
}

function makeFlag(triggerType: string, observedValue: number, yearObserved: number) {
  resetFlagCounter();
  const rule = getRule(triggerType);
  return buildFlag({
    dealId: "deal-e2e",
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

describe("OD End-to-End Regression", () => {

  // ══════════════════════════════════════════════════════════════════════════
  // Fixture 1: Happy path — detail extracted, banker addback, memo + DSCR
  // ══════════════════════════════════════════════════════════════════════════

  it("E2E happy path: extraction → flag → targeted question → addback → memo → DSCR", () => {
    // Step 1: Extract detail from OCR
    const ocr = `
Other Deductions Statement

Consulting fees                   300,000
Management advisory fees          200,000
Insurance premiums                150,000
Legal and professional            100,000
Charitable contributions           40,000
Settlement expense                 60,000

Total other deductions            850,000
    `;
    const extractResult = extractOtherDeductionsDetail({ dealId: "d", bankId: "b", documentId: "doc", ocrText: ocr } as any);
    assert.ok(extractResult.ok, "Extraction should succeed");

    // Verify extracted totals
    const detailTotal = extractResult.items.find((i) => i.key === "OD_DETAIL_TOTAL");
    assert.ok(detailTotal, "Must emit OD_DETAIL_TOTAL");
    assert.equal(detailTotal.value, 850_000);

    // Step 2: Flag engine — large_other_expense fires (850K/10M = 8.5%)
    const facts: Record<string, unknown> = {
      GROSS_RECEIPTS_2024: 10_000_000,
      OTHER_DEDUCTIONS_2024: 850_000,
      OD_DETAIL_TOTAL_2024: 850_000,
      OD_DETAIL_CONSULTING_2024: 300_000,
      OD_DETAIL_MANAGEMENT_FEES_2024: 200_000,
      OD_DETAIL_RELATED_PARTY_TOTAL_2024: 500_000,
    };
    const flags = flagFromReconciliation(makeInput(facts, [2024]));
    const expenseFlag = flags.find((f) => f.trigger_type === "large_other_expense_5pct");
    assert.ok(expenseFlag, "large_other_expense_5pct should fire at 8.5%");

    // Step 3: Question is targeted (detail exists)
    const flag = makeFlag("large_other_expense_5pct", 850_000, 2024);
    const question = generateQuestion(flag, facts);
    assert.ok(question, "Question should be generated");
    assert.ok(question.question_text.includes("consulting") || question.question_text.includes("related-party"),
      "Question should be targeted, not generic");
    assert.ok(!question.question_text.includes("provide a breakdown"),
      "Should NOT ask for generic breakdown when detail exists");

    // Step 4: Banker marks consulting + management as addback
    const bankerMarkedFacts = [
      { id: "f1", fact_key: "OD_DETAIL_CONSULTING", fact_value_num: 300_000, fact_period_end: "2024-12-31", resolution_status: "banker_addback" },
      { id: "f2", fact_key: "OD_DETAIL_MANAGEMENT_FEES", fact_value_num: 200_000, fact_period_end: "2024-12-31", resolution_status: "banker_addback" },
      { id: "f3", fact_key: "OD_DETAIL_INSURANCE", fact_value_num: 150_000, fact_period_end: "2024-12-31", resolution_status: "banker_reviewed" },
      { id: "f4", fact_key: "OD_DETAIL_LEGAL_PROFESSIONAL", fact_value_num: 100_000, fact_period_end: "2024-12-31", resolution_status: "banker_reviewed" },
      { id: "f5", fact_key: "OD_DETAIL_CHARITABLE_CONTRIBUTIONS", fact_value_num: 40_000, fact_period_end: "2024-12-31", resolution_status: null },
      { id: "f6", fact_key: "OD_DETAIL_NON_RECURRING_OR_UNUSUAL", fact_value_num: 60_000, fact_period_end: "2024-12-31", resolution_status: "banker_non_recurring" },
      { id: "f7", fact_key: "OD_DETAIL_TOTAL", fact_value_num: 850_000, fact_period_end: "2024-12-31", resolution_status: null },
      { id: "f8", fact_key: "OD_DETAIL_RECONCILED", fact_value_num: 1, fact_period_end: "2024-12-31", resolution_status: null },
    ];

    // Step 5: Adjustment builder
    const adjustments = buildOdNormalizedEarningsAdjustments(bankerMarkedFacts, 2024);
    assert.equal(adjustments.addbackTotal, 500_000, "Addback = consulting 300K + management 200K");
    assert.equal(adjustments.nonRecurringTotal, 60_000, "Non-recurring = settlement 60K");
    assert.equal(adjustments.totalAdjustment, 560_000, "Total = 500K + 60K");
    assert.equal(adjustments.adjustments.length, 3, "3 adjustment lines");

    // Step 6: Memo narrative uses same totals
    const narrative = buildOdNormalizationNarrative(bankerMarkedFacts, 850_000, 10_000_000, 2024);
    assert.equal(narrative.addbackTotal, 500_000, "Memo addback must equal aggregator addback");
    assert.equal(narrative.nonRecurringTotal, 60_000, "Memo non-recurring must equal aggregator");
    assert.ok(narrative.narrative.includes("$500,000"), "Memo should mention $500K addback");
    assert.ok(narrative.narrative.includes("8.5%"), "Memo should show 8.5% ratio");

    // Step 7: DSCR impact is mathematically explainable
    const baseNcads = 1_200_000;
    const proposedAds = 400_000;
    const baseDscr = baseNcads / proposedAds; // 3.00x
    const adjustedNcads = baseNcads + adjustments.totalAdjustment; // 1,760,000
    const adjustedDscr = adjustedNcads / proposedAds; // 4.40x
    assert.equal(Math.round(baseDscr * 100) / 100, 3.00);
    assert.equal(Math.round(adjustedDscr * 100) / 100, 4.40);
    assert.equal(adjustedNcads - baseNcads, 560_000, "DSCR delta explained by OD adjustment");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Fixture 2: Missing detail — generic request, no NCADS adjustment
  // ══════════════════════════════════════════════════════════════════════════

  it("E2E missing detail: generic document request, no NCADS adjustment", () => {
    // No OD_DETAIL_* facts — detail not extracted
    const facts: Record<string, unknown> = {
      GROSS_RECEIPTS_2024: 10_000_000,
      OTHER_DEDUCTIONS_2024: 850_000,
    };

    // Flag fires
    const flags = flagFromReconciliation(makeInput(facts, [2024]));
    assert.ok(flags.some((f) => f.trigger_type === "large_other_expense_5pct"));

    // Question asks for breakdown (no detail)
    const flag = makeFlag("large_other_expense_5pct", 850_000, 2024);
    const question = generateQuestion(flag, facts);
    assert.ok(question);
    assert.ok(
      question.question_text.includes("breakdown") || question.question_text.includes("attached statement"),
      "Must ask for breakdown when detail missing",
    );
    assert.ok(question.document_requested, "Must request document");

    // No adjustment enters NCADS
    const adjustments = buildOdNormalizedEarningsAdjustments([], 2024);
    assert.equal(adjustments.totalAdjustment, 0);
    assert.equal(adjustments.adjustments.length, 0);

    // Memo fallback
    const narrative = buildOdNormalizationNarrative([], 850_000, 10_000_000, 2024);
    assert.equal(narrative.hasDetail, false);
    assert.ok(narrative.narrative.includes("not available"));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Fixture 3: Unreconciled detail — mismatch flag, only approved lines adjust
  // ══════════════════════════════════════════════════════════════════════════

  it("E2E unreconciled detail: mismatch flag, only approved lines adjust NCADS", () => {
    const facts: Record<string, unknown> = {
      GROSS_RECEIPTS_2024: 10_000_000,
      OTHER_DEDUCTIONS_2024: 850_000,
      OD_DETAIL_TOTAL_2024: 600_000, // $250K mismatch
    };

    // Mismatch flag fires
    const flags = flagFromReconciliation(makeInput(facts, [2024]));
    const mismatch = flags.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch");
    assert.ok(mismatch, "Mismatch flag should fire");

    // Banker approves only one line despite mismatch
    const bankerFacts = [
      { id: "f1", fact_key: "OD_DETAIL_CONSULTING", fact_value_num: 300_000, fact_period_end: "2024-12-31", resolution_status: "banker_addback" },
      { id: "f2", fact_key: "OD_DETAIL_INSURANCE", fact_value_num: 200_000, fact_period_end: "2024-12-31", resolution_status: "banker_reviewed" },
      { id: "f3", fact_key: "OD_DETAIL_RENT", fact_value_num: 100_000, fact_period_end: "2024-12-31", resolution_status: null },
      { id: "f4", fact_key: "OD_DETAIL_TOTAL", fact_value_num: 600_000, fact_period_end: "2024-12-31", resolution_status: null },
      { id: "f5", fact_key: "OD_DETAIL_RECONCILED", fact_value_num: 0, fact_period_end: "2024-12-31", resolution_status: null },
    ];

    // Only consulting addback enters NCADS — NOT the $250K variance
    const adjustments = buildOdNormalizedEarningsAdjustments(bankerFacts, 2024);
    assert.equal(adjustments.totalAdjustment, 300_000, "Only banker-approved consulting enters NCADS");
    assert.equal(adjustments.adjustments.length, 1);

    // Memo notes variance
    const narrative = buildOdNormalizationNarrative(bankerFacts, 850_000, 10_000_000, 2024);
    assert.ok(narrative.narrative.includes("differs"), "Memo must note variance");
    assert.ok(narrative.narrative.includes("$250,000"), "Memo must show variance amount");
    assert.equal(narrative.addbackTotal, 300_000, "Memo addback matches aggregator");
  });
});
