/**
 * SPEC-EBITDA-BASE-INCOME-WIRE-1 — shared EBITDA base-income resolver.
 *
 * Verifies the base-selection ladder
 * (ORDINARY_BUSINESS_INCOME → TAXABLE_INCOME → M1_TAXABLE_INCOME → NET_INCOME)
 * plus a parity snapshot guarding the verbatim extraction from computeEbitda.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveEbitdaBaseIncome } from "../ebitdaBase";
import { computeEbitda } from "../ebitdaEngine";

describe("resolveEbitdaBaseIncome", () => {
  // T1 — OmniCare case: only M1_TAXABLE_INCOME + zeroed NET_INCOME.
  it("[T1] resolves M1_TAXABLE_INCOME when OBI/TAXABLE absent (OmniCare)", () => {
    const r = resolveEbitdaBaseIncome({ M1_TAXABLE_INCOME: 200925, NET_INCOME: 0 });
    assert.equal(r.baseKey, "M1_TAXABLE_INCOME");
    assert.equal(r.baseValue, 200925);
  });

  // T2 — OBI wins over everything.
  it("[T2] ORDINARY_BUSINESS_INCOME wins over M1_TAXABLE_INCOME", () => {
    const r = resolveEbitdaBaseIncome({ ORDINARY_BUSINESS_INCOME: 123, M1_TAXABLE_INCOME: 999 });
    assert.equal(r.baseKey, "ORDINARY_BUSINESS_INCOME");
    assert.equal(r.baseValue, 123);
  });

  // T3 — TAXABLE_INCOME precedes M1_TAXABLE_INCOME.
  it("[T3] TAXABLE_INCOME precedes M1_TAXABLE_INCOME", () => {
    const r = resolveEbitdaBaseIncome({ TAXABLE_INCOME: 50, M1_TAXABLE_INCOME: 60 });
    assert.equal(r.baseKey, "TAXABLE_INCOME");
    assert.equal(r.baseValue, 50);
  });

  // T4 — C-corp reconstruction from after-tax NET_INCOME via tax provision.
  it("[T4] reconstructs from NET_INCOME with TOTAL_TAX add-back", () => {
    const r = resolveEbitdaBaseIncome({ NET_INCOME: 100, TOTAL_TAX: 21 });
    assert.equal(r.baseKey, "NET_INCOME");
    assert.equal(r.baseValue, 100);
    assert.notEqual(r.taxAddBack, null);
    assert.equal(r.taxAddBack?.value, 21);
    assert.equal(r.taxAddBack?.key, "TOTAL_TAX");
  });
});

describe("computeEbitda parity after extraction", () => {
  // T5 — computeEbitda output unchanged vs a pre-refactor snapshot.
  it("[T5] produces the snapshotted analysis for a representative fact set", () => {
    const facts = {
      NET_INCOME: 1_000_000,
      TOTAL_TAX: 210_000,
      INTEREST_EXPENSE: 50_000,
      DEPRECIATION: 120_000,
      AMORTIZATION: 15_000,
      SECTION_179_EXPENSE: 30_000,
      BONUS_DEPRECIATION: 25_000,
      GUARANTEED_PAYMENTS: 80_000,
      NON_RECURRING_EXPENSE: 40_000,
      NON_RECURRING_INCOME: 10_000,
    };
    const a = computeEbitda(facts, "FORM_1065");

    assert.equal(a.reportedOBI, null);
    assert.equal(a.baseKey, "NET_INCOME");
    assert.equal(a.baseLabel, "Net income (after-tax, reconstructed to pre-tax)");
    assert.equal(a.baseValue, 1_000_000);
    assert.deepEqual(
      a.addBacks,
      [
        {
          key: "TAX_PROVISION",
          label: "Federal Tax Provision (reconstruct pre-tax base)",
          value: 210_000,
          source: "EXTRACTED",
          notes:
            "C-corp EBITDA base reconstructed from after-tax NET_INCOME by adding the tax provision back to pre-tax.",
        },
        { key: "INTEREST_EXPENSE", label: "Interest Expense", value: 50_000, source: "EXTRACTED", notes: "" },
        { key: "DEPRECIATION", label: "Depreciation & Amortization", value: 120_000, source: "EXTRACTED", notes: "" },
        { key: "AMORTIZATION", label: "Amortization", value: 15_000, source: "EXTRACTED", notes: "" },
        { key: "SECTION_179_EXPENSE", label: "Section 179 Expense", value: 30_000, source: "EXTRACTED", notes: "" },
        { key: "BONUS_DEPRECIATION", label: "Bonus Depreciation", value: 25_000, source: "EXTRACTED", notes: "" },
        {
          key: "GUARANTEED_PAYMENTS",
          label: "Guaranteed Payments to Partners",
          value: 80_000,
          source: "EXTRACTED",
          notes: "Treated as officer compensation equivalent — added back to normalize",
        },
        { key: "NON_RECURRING_EXPENSE", label: "Non-Recurring Expense Add-Back", value: 40_000, source: "EXTRACTED", notes: "" },
        { key: "NON_RECURRING_INCOME", label: "Non-Recurring Income Deduction", value: -10_000, source: "EXTRACTED", notes: "" },
      ],
    );
    // 1,000,000 + 210,000 + 50,000 + 120,000 + 15,000 + 30,000 + 25,000 + 80,000 + 40,000 − 10,000
    assert.equal(a.adjustedEbitda, 1_560_000);
    assert.deepEqual(a.warnings, []);
  });
});
