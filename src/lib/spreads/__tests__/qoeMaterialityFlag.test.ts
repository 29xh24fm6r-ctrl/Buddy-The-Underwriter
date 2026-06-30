/**
 * SPEC-QOE-OWNERBENEFIT-ACTIVATION-1 — interim QoE materiality flag.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMaterialityQoEInput,
  computeQoEMaterialityFlags,
  computeQoEMaterialityFlagsFromFacts,
} from "../qoeMaterialityFlag";
import { computeQualityOfEarnings } from "../qoeEngine";

// T1 — materiality fires when a rolled-up bucket exceeds 5% of revenue.
test("[T1] Other Income > 5% of revenue raises a documentation-required flag", () => {
  const res = computeQoEMaterialityFlagsFromFacts({ OTHER_INCOME: 100_000, GROSS_RECEIPTS: 1_000_000 });
  assert.equal(res.flags.length, 1);
  const f = res.flags[0];
  assert.equal(f.lineItem, "Other Income");
  assert.equal(f.amount, 100_000);
  assert.equal(f.pctOfRevenue, 10);
  assert.equal(f.documentationRequired, true);
});

// T1b — same for the expense bucket (OTHER_DEDUCTIONS → "Other Expense").
test("[T1b] Other Expense > 5% of revenue raises a flag", () => {
  const res = computeQoEMaterialityFlagsFromFacts({ OTHER_DEDUCTIONS: 80_000, TOTAL_REVENUE: 1_000_000 });
  assert.equal(res.flags.length, 1);
  assert.equal(res.flags[0].lineItem, "Other Expense");
  assert.equal(res.flags[0].amount, 80_000);
});

// T2 — does NOT fire below the 5% threshold.
test("[T2] Other Income <= 5% of revenue raises no flag", () => {
  const res = computeQoEMaterialityFlagsFromFacts({ OTHER_INCOME: 40_000, GROSS_RECEIPTS: 1_000_000 });
  assert.equal(res.flags.length, 0);
});

// T3 — grain guard: a rolled-up "Other Income" label can ONLY trigger materiality,
// never specific PPP/EIDL/ERC auto-classification. A descriptive label would.
// This is exactly why Phase 0 (granular capture) is required.
test("[T3] rolled-up label fires materiality only, not specific auto-classification", () => {
  const rolledUp = computeQoEMaterialityFlags(
    buildMaterialityQoEInput({ otherIncome: 100_000, otherExpense: null, revenue: 1_000_000 }),
  );
  // Materiality flag present, and it requires documentation (not auto-approved).
  assert.equal(rolledUp.adjustments.length, 1);
  assert.equal(rolledUp.adjustments[0].autoApproved, false);
  assert.equal(rolledUp.adjustments[0].documentationRequired, true);

  // Contrast: a DESCRIPTIVE label routed through the engine auto-classifies
  // (autoApproved), proving the grain — not available from rolled-up facts today.
  const descriptive = computeQualityOfEarnings({
    reportedEbitda: 0,
    incomeItems: [{ label: "PPP loan forgiveness", amount: 100_000, source: "x" }],
    expenseItems: [],
    revenue: 1_000_000,
    priorYearBadDebt: null,
    priorYearLegalFees: null,
  });
  assert.equal(descriptive.adjustments.length, 1);
  assert.equal(descriptive.adjustments[0].classification, "non_recurring_income");
  assert.equal(descriptive.adjustments[0].autoApproved, true);
});

// T4 — null-safe: empty facts produce no flags and do not throw.
test("[T4] empty facts → no flags, no throw, high confidence", () => {
  const res = computeQoEMaterialityFlagsFromFacts({});
  assert.equal(res.flags.length, 0);
  assert.equal(res.adjustments.length, 0);
  assert.equal(res.confidence, "high");
});

// Guard — first-present resolution avoids double-counting duplicate buckets.
test("[resolve] first-present key wins (no double count)", () => {
  const res = computeQoEMaterialityFlagsFromFacts({
    OTHER_INCOME: 100_000,
    SK_OTHER_INCOME: 100_000,
    GROSS_RECEIPTS: 1_000_000,
  });
  assert.equal(res.flags.length, 1);
  assert.equal(res.flags[0].amount, 100_000);
});
