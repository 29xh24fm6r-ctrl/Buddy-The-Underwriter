import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeDebtService, resolveEffectiveRate } from "@/lib/structuralPricing/debtServiceMath";

// ──────────────────────────────────────────────────────────────
// computeDebtService
// ──────────────────────────────────────────────────────────────
describe("computeDebtService", () => {
  test("standard amortization: $1M at 6% over 300 months", () => {
    const result = computeDebtService({
      principal: 1_000_000,
      ratePct: 6.0,
      amortMonths: 300,
      interestOnlyMonths: 0,
    });

    assert.ok(result.monthlyPayment != null);
    assert.ok(result.annualDebtService != null);

    // Expected: PMT = P * r / (1 - (1+r)^-n)
    // r = 0.06/12 = 0.005, n = 300
    // PMT = 1000000 * 0.005 / (1 - 1.005^-300) ≈ $6,443.01
    assert.ok(result.monthlyPayment > 6400 && result.monthlyPayment < 6500);
    assert.ok(Math.abs(result.annualDebtService! - result.monthlyPayment! * 12) < 0.01);
  });

  test("interest-only when IO months >= amort months", () => {
    const result = computeDebtService({
      principal: 1_000_000,
      ratePct: 5.0,
      amortMonths: 240,
      interestOnlyMonths: 240,
    });

    assert.ok(result.monthlyPayment != null);
    // IO payment = 1M * 0.05 / 12 ≈ $4,166.67
    const expected = (1_000_000 * 0.05) / 12;
    assert.ok(Math.abs(result.monthlyPayment! - expected) < 0.01);
  });

  test("zero rate: straight-line principal / months", () => {
    const result = computeDebtService({
      principal: 1_200_000,
      ratePct: 0,
      amortMonths: 240,
      interestOnlyMonths: 0,
    });

    assert.ok(result.monthlyPayment != null);
    // 1200000 / 240 = 5000
    assert.equal(result.monthlyPayment, 5000);
    assert.equal(result.annualDebtService, 60000);
  });

  test("zero principal → null", () => {
    const result = computeDebtService({
      principal: 0,
      ratePct: 5.0,
      amortMonths: 300,
      interestOnlyMonths: 0,
    });

    assert.equal(result.monthlyPayment, null);
    assert.equal(result.annualDebtService, null);
  });

  test("negative principal → null", () => {
    const result = computeDebtService({
      principal: -500000,
      ratePct: 5.0,
      amortMonths: 300,
      interestOnlyMonths: 0,
    });

    assert.equal(result.monthlyPayment, null);
    assert.equal(result.annualDebtService, null);
  });

  test("negative rate → null", () => {
    const result = computeDebtService({
      principal: 1_000_000,
      ratePct: -1.0,
      amortMonths: 300,
      interestOnlyMonths: 0,
    });

    assert.equal(result.monthlyPayment, null);
    assert.equal(result.annualDebtService, null);
  });

  test("short amort (36 months) at 7%", () => {
    const result = computeDebtService({
      principal: 500_000,
      ratePct: 7.0,
      amortMonths: 36,
      interestOnlyMonths: 0,
    });

    assert.ok(result.monthlyPayment != null);
    // PMT ≈ $15,441 range
    assert.ok(result.monthlyPayment > 15000 && result.monthlyPayment < 16000);
  });

  test("annualDebtService is always monthlyPayment × 12", () => {
    const result = computeDebtService({
      principal: 2_500_000,
      ratePct: 5.5,
      amortMonths: 360,
      interestOnlyMonths: 0,
    });

    assert.ok(result.monthlyPayment != null);
    assert.ok(result.annualDebtService != null);
    assert.ok(Math.abs(result.annualDebtService! - result.monthlyPayment! * 12) < 0.01);
  });
});

// ──────────────────────────────────────────────────────────────
// resolveEffectiveRate
// ──────────────────────────────────────────────────────────────
describe("resolveEffectiveRate", () => {
  test("fixed rate: returns fixed_rate_pct directly", () => {
    const rate = resolveEffectiveRate({
      rateType: "fixed",
      fixedRatePct: 6.75,
      indexRatePct: 4.5,
      spreadBps: 200,
      floorRatePct: 5.0,
    });

    assert.equal(rate, 6.75);
  });

  test("fixed rate: null when fixedRatePct not provided", () => {
    const rate = resolveEffectiveRate({
      rateType: "fixed",
      fixedRatePct: null,
    });

    assert.equal(rate, null);
  });

  test("floating rate: index + spread", () => {
    const rate = resolveEffectiveRate({
      rateType: "floating",
      indexRatePct: 4.5,
      spreadBps: 250,
      floorRatePct: null,
    });

    // 4.5 + 250/100 = 4.5 + 2.5 = 7.0
    assert.equal(rate, 7.0);
  });

  test("floating rate: floor wins when > index+spread", () => {
    const rate = resolveEffectiveRate({
      rateType: "floating",
      indexRatePct: 2.0,
      spreadBps: 150,
      floorRatePct: 5.5,
    });

    // max(5.5, 2.0 + 1.5) = max(5.5, 3.5) = 5.5
    assert.equal(rate, 5.5);
  });

  test("floating rate: index+spread wins when > floor", () => {
    const rate = resolveEffectiveRate({
      rateType: "floating",
      indexRatePct: 4.5,
      spreadBps: 300,
      floorRatePct: 5.0,
    });

    // max(5.0, 4.5 + 3.0) = max(5.0, 7.5) = 7.5
    assert.equal(rate, 7.5);
  });

  test("floating rate: defaults to 0 when nulls", () => {
    const rate = resolveEffectiveRate({
      rateType: "floating",
      indexRatePct: null,
      spreadBps: null,
      floorRatePct: null,
    });

    // max(0, 0 + 0) = 0
    assert.equal(rate, 0);
  });

  test("floating rate: only spread, no index", () => {
    const rate = resolveEffectiveRate({
      rateType: "floating",
      indexRatePct: null,
      spreadBps: 350,
      floorRatePct: null,
    });

    // 0 + 3.5 = 3.5
    assert.equal(rate, 3.5);
  });
});
