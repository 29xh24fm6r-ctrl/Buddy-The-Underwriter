/**
 * Unit tests for the deal-type-aware completeness gates added to
 * sectionBuilders.ts's global_cash_flow, personal_financial_statements, and
 * repayment_breakeven builders. Exercises the builder functions directly
 * (bypassing buildFloridaArmorySnapshot/assertCommitteeMemoSafe, which
 * would otherwise throw the moment any warning fires) so the exact warning
 * text can be asserted.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGlobalCashFlowSection,
  buildPfsSection,
  buildRepaymentBreakevenSection,
} from "@/lib/creditMemo/snapshot/sectionBuilders";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";

function baseMemo(overrides: Record<string, unknown> = {}): CanonicalCreditMemoV1 {
  return {
    global_cash_flow: { global_cf_table: [] },
    personal_financial_statements: [],
    financial_analysis: { breakeven: { baseline_dscr: null } },
    meta: {
      deal_classification: {
        is_cre_deal: false,
        is_loc_deal: false,
        has_individual_guarantor_at_threshold: false,
        is_new_business: false,
      },
    },
    ...overrides,
  } as unknown as CanonicalCreditMemoV1;
}

const input = (memo: CanonicalCreditMemoV1) => ({ memo, sources: [] });

// ─── global_cash_flow ───────────────────────────────────────────────────────

test("[sbg-1] global_cash_flow: no guarantor evidence -> no warning even with empty data", () => {
  const section = buildGlobalCashFlowSection(input(baseMemo()));
  assert.deepEqual(section.warnings, []);
});

test("[sbg-2] global_cash_flow: guarantor evidence + empty table -> warns", () => {
  const memo = baseMemo();
  (memo.meta as any).deal_classification.has_individual_guarantor_at_threshold = true;
  const section = buildGlobalCashFlowSection(input(memo));
  assert.deepEqual(section.warnings, ["Global cash flow missing for a deal with an individual guarantor"]);
});

test("[sbg-3] global_cash_flow: guarantor evidence + populated table -> no warning", () => {
  const memo = baseMemo({
    global_cash_flow: { global_cf_table: [{ period: "2025", global_dscr: 1.4 }] },
  });
  (memo.meta as any).deal_classification.has_individual_guarantor_at_threshold = true;
  const section = buildGlobalCashFlowSection(input(memo));
  assert.deepEqual(section.warnings, []);
});

// ─── personal_financial_statements ─────────────────────────────────────────

test("[sbg-4] pfs: no guarantor evidence -> no warning even with empty data", () => {
  const section = buildPfsSection(input(baseMemo()));
  assert.deepEqual(section.warnings, []);
});

test("[sbg-5] pfs: guarantor evidence + empty array -> warns", () => {
  const memo = baseMemo();
  (memo.meta as any).deal_classification.has_individual_guarantor_at_threshold = true;
  const section = buildPfsSection(input(memo));
  assert.deepEqual(section.warnings, ["Personal financial statement missing for an individual guarantor"]);
});

test("[sbg-6] pfs: guarantor evidence + populated array -> no warning", () => {
  const memo = baseMemo({
    personal_financial_statements: [{ owner_entity_id: "o1", name: "Jane Smith" }],
  });
  (memo.meta as any).deal_classification.has_individual_guarantor_at_threshold = true;
  const section = buildPfsSection(input(memo));
  assert.deepEqual(section.warnings, []);
});

// ─── repayment_breakeven ────────────────────────────────────────────────────

test("[sbg-7] repayment_breakeven: not a new business -> no warning even with null breakeven", () => {
  const section = buildRepaymentBreakevenSection(input(baseMemo()));
  assert.deepEqual(section.warnings, []);
});

test("[sbg-8] repayment_breakeven: new business + null baseline_dscr -> warns", () => {
  const memo = baseMemo();
  (memo.meta as any).deal_classification.is_new_business = true;
  const section = buildRepaymentBreakevenSection(input(memo));
  assert.deepEqual(section.warnings, ["Repayment breakeven analysis missing for a new business (< 2 years)"]);
});

test("[sbg-9] repayment_breakeven: new business + populated baseline_dscr -> no warning", () => {
  const memo = baseMemo({
    financial_analysis: { breakeven: { baseline_dscr: 1.3 } },
  });
  (memo.meta as any).deal_classification.is_new_business = true;
  const section = buildRepaymentBreakevenSection(input(memo));
  assert.deepEqual(section.warnings, []);
});
