/**
 * SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1 — classic EBITDA reconciles to canonical EBITDA.
 *
 * Proves the printed/classic EBITDA equals the canonical EBITDA engine's output for the same
 * period/entity (no §179/non-recurring facts, which the classic spread intentionally does not apply),
 * with the C-corp income-tax add-back applied consistently.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classicTraditionalEbitda } from "@/lib/classicSpread/classicEbitda";
import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";

const getter = (facts: Record<string, number>) => (key: string) =>
  key in facts ? facts[key] : null;

test("C-corp (NET_INCOME base): classic EBITDA adds the income-tax provision back — equals canonical", () => {
  // After-tax NET_INCOME, with a tax provision available for reconstruction.
  const facts = {
    NET_INCOME: 800_000,
    TOTAL_TAX: 200_000,
    INTEREST_EXPENSE: 100_000,
    DEPRECIATION: 50_000,
    AMORTIZATION: 0,
  };
  const classic = classicTraditionalEbitda(getter(facts));
  const canonical = computeEbitda(facts, "FORM_1120").adjustedEbitda;

  // Pre-tax base 800k + 200k tax + 100k interest + 50k depreciation = 1.15M.
  assert.equal(classic, 1_150_000);
  assert.equal(classic, canonical, "classic EBITDA must equal canonical EBITDA");

  // The OLD classic formula (after-tax NET_INCOME + add-backs, no tax) understated by the tax provision.
  const oldFormula = facts.NET_INCOME + facts.INTEREST_EXPENSE + facts.DEPRECIATION + facts.AMORTIZATION;
  assert.equal(oldFormula, 950_000);
  assert.ok(classic! > oldFormula, "the fix must add the income-tax provision back");
});

test("C-corp (pre-tax TAXABLE_INCOME base): no add-back, equals canonical", () => {
  const facts = {
    TAXABLE_INCOME: 1_000_000,
    NET_INCOME: 800_000, // present but not used — pre-tax base wins
    TOTAL_TAX: 200_000,
    INTEREST_EXPENSE: 100_000,
    DEPRECIATION: 50_000,
  };
  const classic = classicTraditionalEbitda(getter(facts));
  const canonical = computeEbitda(facts, "FORM_1120").adjustedEbitda;
  assert.equal(classic, 1_150_000);
  assert.equal(classic, canonical);
});

test("pass-through (ORDINARY_BUSINESS_INCOME base): equals canonical, no tax add-back", () => {
  const facts = {
    ORDINARY_BUSINESS_INCOME: 900_000,
    INTEREST_EXPENSE: 100_000,
    DEPRECIATION: 50_000,
  };
  const classic = classicTraditionalEbitda(getter(facts));
  const canonical = computeEbitda(facts, "FORM_1120S").adjustedEbitda;
  assert.equal(classic, 1_050_000);
  assert.equal(classic, canonical);
});

test("no base income → null (never a fabricated EBITDA)", () => {
  assert.equal(classicTraditionalEbitda(getter({ INTEREST_EXPENSE: 100_000 })), null);
});
