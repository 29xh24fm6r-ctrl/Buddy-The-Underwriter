/**
 * SPEC-FIN-TL-1 — Total Liabilities prefers the extracted totalCurrentLiabilities
 * subtotal; falls back to the component sum; flags material disagreement and
 * missing current-liabilities data.
 *
 * §0.3 note: OmniCare 365's FY2022 balance sheet does NOT reproduce the symptom
 * through buildFinancialModel — FY2022 is only in TAX_RETURN_BALANCE_SHEET (not
 * consumed by the model), and its live BALANCE_SHEET periods carry a raw
 * TOTAL_LIABILITIES fact that bypasses the derivation. The regression is proven
 * with a synthetic fixture matching the summarized-Schedule-L shape, anchored to
 * OmniCare's real 2026-03-31 current-liabilities numbers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFinancialModel, type FactInput } from "../buildFinancialModel";

const PE = "2022-12-31";
const F = (k: string, v: number, pe = PE): FactInput => ({
  fact_type: "TAX_RETURN",
  fact_key: k,
  fact_value_num: v,
  fact_period_end: pe,
  confidence: 0.8,
});

function period(facts: FactInput[]) {
  return buildFinancialModel("d", facts).periods[0];
}
const disagreement = (flags: string[]) =>
  flags.find((f) => f.startsWith("BALANCE_SHEET_SUBTOTAL_DISAGREEMENT"));

describe("SPEC-FIN-TL-1 — Total Liabilities subtotal preference", () => {
  it("1. summarized Schedule L: prefers subtotal, components all zero", () => {
    // The FY2022 shape — the root-cause case. Pre-fix this collapsed to LTD only.
    const p = period([F("TOTAL_CURRENT_LIABILITIES", 500_000), F("LONG_TERM_DEBT", 300_000)]);
    assert.equal(p.balance.totalLiabilities, 800_000);
    assert.equal(disagreement(p.qualityFlags), undefined, "no disagreement (components are 0)");
  });

  it("2. fully itemized (no subtotal): sums components + LTD", () => {
    const p = period([
      F("ACCOUNTS_PAYABLE", 200_000),
      F("OTHER_CURRENT_LIABILITIES", 100_000),
      F("ACCRUED_LIABILITIES", 50_000),
      F("SHORT_TERM_DEBT", 150_000),
      F("LONG_TERM_DEBT", 300_000),
    ]);
    assert.equal(p.balance.totalCurrentLiabilities, 500_000, "backfilled from components");
    assert.equal(p.balance.totalLiabilities, 800_000);
    assert.equal(disagreement(p.qualityFlags), undefined, "no extracted subtotal → no disagreement");
  });

  it("3. both present, agree within materiality: subtotal wins, no warning", () => {
    // subtotal 500k vs components 498k → delta 2k < max(1000, 5%×500k=25k).
    const p = period([
      F("TOTAL_CURRENT_LIABILITIES", 500_000),
      F("ACCOUNTS_PAYABLE", 498_000),
      F("LONG_TERM_DEBT", 300_000),
    ]);
    assert.equal(p.balance.totalLiabilities, 800_000, "from subtotal");
    assert.equal(disagreement(p.qualityFlags), undefined);
  });

  it("4. both present, disagree materially: subtotal wins, warning emitted", () => {
    // subtotal 500k vs components 350k → delta 150k > 25k threshold.
    const p = period([
      F("TOTAL_CURRENT_LIABILITIES", 500_000),
      F("ACCOUNTS_PAYABLE", 350_000),
      F("LONG_TERM_DEBT", 300_000),
    ]);
    assert.equal(p.balance.totalLiabilities, 800_000, "still the subtotal");
    const w = disagreement(p.qualityFlags);
    assert.ok(w, "disagreement warning emitted");
    assert.match(w!, /subtotal=500000/);
    assert.match(w!, /components=350000/);
    assert.match(w!, /delta=150000/);
    assert.match(w!, /chosen=subtotal/);
  });

  it("5. neither present: TL is LTD floor + missing-data warning (not silent)", () => {
    const p = period([F("LONG_TERM_DEBT", 300_000)]);
    assert.equal(p.balance.totalLiabilities, 300_000);
    assert.ok(
      p.qualityFlags.includes("MISSING_CURRENT_LIABILITIES"),
      "must NOT silently pass TL=300k as clean — the missing-data flag fires",
    );
  });

  it("6. existing balance-identity check still fires (fix does not disable it)", () => {
    // Raw equity that disagrees with assets − TL must still flag imbalance.
    const p = period([
      F("TOTAL_ASSETS", 1_000_000),
      F("TOTAL_CURRENT_LIABILITIES", 500_000),
      F("LONG_TERM_DEBT", 300_000),
      F("TOTAL_EQUITY", 100_000), // real assets − TL = 200k, so 100k disagrees
    ]);
    assert.equal(p.balance.totalLiabilities, 800_000);
    assert.equal(p.balance.equity, 100_000, "raw equity fact is NOT overridden");
    assert.ok(
      p.qualityFlags.includes("BALANCE_SHEET_IMBALANCE"),
      "imbalance still detected: TA(1000k) ≠ TL(800k) + E(100k)",
    );
  });

  it("7. FY2022 regression anchor (OmniCare 2026-03-31 current-liabs shape)", () => {
    // Real numbers: TOTAL_CURRENT_LIABILITIES 94,443.98 with only AP 61,994.57
    // itemized, no raw TOTAL_LIABILITIES. Pre-fix TL collapsed to the component
    // sum (61,994.57); post-fix it is the subtotal (94,443.98), and the itemized
    // AP vs subtotal gap surfaces as a disagreement.
    const p = period([
      F("TOTAL_CURRENT_LIABILITIES", 94_443.98),
      F("ACCOUNTS_PAYABLE", 61_994.57),
    ]);
    assert.equal(p.balance.totalLiabilities, 94_443.98, "subtotal, not the AP-only component sum");
    assert.notEqual(p.balance.totalLiabilities, 61_994.57, "the pre-fix (buggy) value");
    assert.ok(disagreement(p.qualityFlags), "AP-only vs subtotal disagreement surfaced");
  });

  it("raw TOTAL_LIABILITIES fact is still NOT overridden by the derivation", () => {
    // Regression guard for completeDerivation.test.ts's fact-over-formula contract.
    const p = period([F("TOTAL_LIABILITIES", 250_000), F("TOTAL_CURRENT_LIABILITIES", 500_000)]);
    assert.equal(p.balance.totalLiabilities, 250_000, "extracted total wins over derivation");
  });
});
