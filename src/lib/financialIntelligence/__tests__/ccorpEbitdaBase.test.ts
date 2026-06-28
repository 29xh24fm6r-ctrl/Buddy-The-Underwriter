import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeEbitda } from "../ebitdaEngine";

/**
 * SPEC-CANONICAL-DSCR-NCADS-PERFECTION-PROGRAM-1 Phase 1 — C-corp EBITDA base.
 * Form 1120 C-corps (no ORDINARY_BUSINESS_INCOME) compute EBITDA from pre-tax
 * TAXABLE_INCOME (no tax add-back), else NET_INCOME reconstructed via tax provision.
 * Pass-through (1120S/1065) behavior is preserved.
 */

describe("Form 1120 C-corp EBITDA base", () => {
  it("uses pre-tax TAXABLE_INCOME as the base with NO tax add-back (OmniCare-shaped)", () => {
    const a = computeEbitda(
      { TAXABLE_INCOME: 200_925, DEPRECIATION: 210_207, INTEREST_EXPENSE: 30_000 },
      "FORM_1120",
    );
    assert.equal(a.baseKey, "TAXABLE_INCOME");
    assert.match(a.baseLabel, /pre-tax/i);
    assert.equal(a.baseValue, 200_925);
    // EBITDA = taxable + interest + depreciation (NO tax add-back; taxable is pre-tax).
    assert.equal(a.adjustedEbitda, 200_925 + 210_207 + 30_000);
    assert.equal(a.addBacks.some((b) => b.key === "TAX_PROVISION"), false);
    assert.match(a.adjustedEbitdaComponents, /Taxable income \(pre-tax\)/);
  });

  it("C-corp EBITDA is not null when valid 1120 facts exist (no crude fallback needed)", () => {
    const a = computeEbitda({ TAXABLE_INCOME: 100_000, DEPRECIATION: 50_000 }, "FORM_1120");
    assert.notEqual(a.adjustedEbitda, null);
    assert.equal(a.adjustedEbitda, 150_000);
  });

  it("uses Schedule M-1 taxable income (pre-tax) when the plain TAXABLE_INCOME line is absent", () => {
    // SPEC-FINENGINE-LIVE-SPREAD-1 Phase 3 fix: M1_TAXABLE_INCOME is pre-tax and must
    // be preferred over after-tax NET_INCOME(0) — otherwise EBITDA understates by the
    // full pre-tax income (the live −$200,925 OmniCare divergence).
    const a = computeEbitda(
      { M1_TAXABLE_INCOME: 200_925, NET_INCOME: 0, DEPRECIATION: 210_207 },
      "FORM_1120",
    );
    assert.equal(a.baseKey, "M1_TAXABLE_INCOME");
    assert.match(a.baseLabel, /pre-tax/i);
    assert.equal(a.baseValue, 200_925);
    assert.equal(a.adjustedEbitda, 200_925 + 210_207); // 411,132 — NO tax add-back (M1 is pre-tax)
    assert.equal(a.addBacks.some((b) => b.key === "TAX_PROVISION"), false);
  });

  it("prefers the plain TAXABLE_INCOME line over M1 when both are present", () => {
    const a = computeEbitda(
      { TAXABLE_INCOME: 200_925, M1_TAXABLE_INCOME: 999_999, DEPRECIATION: 50_000 },
      "FORM_1120",
    );
    assert.equal(a.baseKey, "TAXABLE_INCOME");
    assert.equal(a.baseValue, 200_925);
  });

  it("falls back to NET_INCOME reconstructed to pre-tax (adds the tax provision)", () => {
    const a = computeEbitda(
      { NET_INCOME: 150_000, TOTAL_TAX: 40_000, DEPRECIATION: 20_000 },
      "FORM_1120",
    );
    assert.equal(a.baseKey, "NET_INCOME");
    assert.equal(a.baseValue, 150_000);
    const taxAddback = a.addBacks.find((b) => b.key === "TAX_PROVISION");
    assert.ok(taxAddback, "tax provision added back to reconstruct pre-tax");
    assert.equal(taxAddback!.value, 40_000);
    assert.equal(a.adjustedEbitda, 150_000 + 40_000 + 20_000);
  });

  it("NET_INCOME base with no tax provision warns (understated pre-tax)", () => {
    const a = computeEbitda({ NET_INCOME: 150_000, DEPRECIATION: 20_000 }, "FORM_1120");
    assert.equal(a.baseKey, "NET_INCOME");
    assert.ok(a.warnings.some((w) => /understate/i.test(w)));
  });

  it("no income facts at all → EBITDA null + caveat (no fabricated base)", () => {
    const a = computeEbitda({ DEPRECIATION: 20_000 }, "FORM_1120");
    assert.equal(a.adjustedEbitda, null);
    assert.equal(a.baseKey, null);
    assert.ok(a.warnings.some((w) => /base unavailable/i.test(w)));
  });
});

describe("pass-through behavior preserved", () => {
  it("1120S uses ORDINARY_BUSINESS_INCOME (not taxable) even if taxable also present", () => {
    const a = computeEbitda(
      { ORDINARY_BUSINESS_INCOME: 300_000, TAXABLE_INCOME: 999_999, DEPRECIATION: 50_000 },
      "FORM_1120",
    );
    assert.equal(a.baseKey, "ORDINARY_BUSINESS_INCOME");
    assert.equal(a.baseValue, 300_000);
    assert.equal(a.adjustedEbitda, 350_000);
  });

  it("1065 uses OBI + guaranteed-payments add-back", () => {
    const a = computeEbitda(
      { ORDINARY_BUSINESS_INCOME: 200_000, GUARANTEED_PAYMENTS: 80_000, DEPRECIATION: 20_000 },
      "FORM_1065",
    );
    assert.equal(a.baseKey, "ORDINARY_BUSINESS_INCOME");
    assert.ok(a.addBacks.some((b) => b.key === "GUARANTEED_PAYMENTS" && b.value === 80_000));
    assert.equal(a.adjustedEbitda, 200_000 + 80_000 + 20_000);
  });
});
