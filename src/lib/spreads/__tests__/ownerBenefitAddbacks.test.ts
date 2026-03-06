import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeOwnerBenefitAddbacks } from "../ownerBenefitAddbacks";
import type { OwnerBenefitInput } from "../ownerBenefitAddbacks";

const BASE_INPUT: OwnerBenefitInput = {
  reportedEbitda: 500_000,
  ownerCompensation: null,
  marketRateCompensation: null,
  autoExpense: null,
  businessUsePct: null,
  homeOfficeExpense: null,
  cellPhoneExpense: null,
  familyCompensation: null,
  familyMarketRate: null,
  ownerLifeInsurance: null,
  ownerHealthInsurance: null,
  ownerDisabilityInsurance: null,
  actualRent: null,
  marketRent: null,
  travelMealsTotal: null,
  personalPct: null,
};

describe("Owner Benefit Add-backs", () => {
  it("returns zero addbacks when no inputs provided", () => {
    const result = computeOwnerBenefitAddbacks(BASE_INPUT);
    assert.equal(result.totalAddbacks, 0);
    assert.equal(result.adjustedEbitda, 500_000);
    assert.equal(result.items.length, 0);
  });

  it("computes excess owner compensation addback", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      ownerCompensation: 400_000,
      marketRateCompensation: 150_000,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].canonicalKey, "ADDBACK_EXCESS_COMPENSATION");
    assert.equal(result.items[0].amount, 250_000);
    assert.equal(result.adjustedEbitda, 750_000);
  });

  it("does not add back when comp is at or below market", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      ownerCompensation: 100_000,
      marketRateCompensation: 150_000,
    });
    assert.equal(result.items.length, 0);
  });

  it("computes auto personal use with default 65% business", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      autoExpense: 10_000,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].canonicalKey, "ADDBACK_AUTO_PERSONAL_USE");
    assert.equal(result.items[0].amount, 3_500); // 35% of 10k
    assert.equal(result.items[0].documentationRequired, true);
    assert.ok(result.documentationGaps.some((g) => g.includes("mileage log")));
  });

  it("computes auto personal use with provided business%", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      autoExpense: 10_000,
      businessUsePct: 0.80,
    });
    assert.ok(Math.abs(result.items[0].amount - 2_000) < 0.01); // 20% of 10k
    assert.equal(result.items[0].documentationRequired, false);
  });

  it("adds back home office and cell phone", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      homeOfficeExpense: 5_000,
      cellPhoneExpense: 2_400,
    });
    assert.equal(result.items.length, 2);
    assert.equal(result.totalAddbacks, 7_400);
  });

  it("adds back excess family compensation", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      familyCompensation: 80_000,
      familyMarketRate: 30_000,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].amount, 50_000);
    assert.equal(result.items[0].documentationRequired, true);
    assert.ok(result.documentationGaps.some((g) => g.includes("Family member")));
  });

  it("adds back owner insurance (life + health + disability)", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      ownerLifeInsurance: 5_000,
      ownerHealthInsurance: 18_000,
      ownerDisabilityInsurance: 3_000,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].canonicalKey, "ADDBACK_OWNER_INSURANCE");
    assert.equal(result.items[0].amount, 26_000);
  });

  it("handles above-market rent (add back excess)", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      actualRent: 120_000,
      marketRent: 80_000,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].canonicalKey, "ADDBACK_RENT_NORMALIZATION");
    assert.equal(result.items[0].amount, 40_000);
    assert.ok(result.items[0].description.includes("Above-market"));
  });

  it("handles below-market rent (negative addback)", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      actualRent: 60_000,
      marketRent: 80_000,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].amount, -20_000); // negative = add expense
    assert.ok(result.items[0].description.includes("Below-market"));
  });

  it("computes travel/meals with default 50% personal", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      travelMealsTotal: 20_000,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].amount, 10_000);
    assert.ok(result.documentationGaps.some((g) => g.includes("travel breakdown")));
  });

  it("aggregates all 7 categories correctly", () => {
    const result = computeOwnerBenefitAddbacks({
      ...BASE_INPUT,
      ownerCompensation: 300_000,
      marketRateCompensation: 150_000,
      autoExpense: 10_000,
      businessUsePct: 0.70,
      homeOfficeExpense: 5_000,
      cellPhoneExpense: 1_200,
      familyCompensation: 60_000,
      familyMarketRate: 30_000,
      ownerLifeInsurance: 4_000,
      ownerHealthInsurance: 12_000,
      ownerDisabilityInsurance: 2_000,
      actualRent: 100_000,
      marketRent: 80_000,
      travelMealsTotal: 15_000,
      personalPct: 0.40,
    });
    // 150k + 3k + 5k + 1.2k + 30k + 18k + 20k + 6k = 233.2k
    assert.ok(result.items.length >= 7);
    assert.equal(result.adjustedEbitda, 500_000 + result.totalAddbacks);
  });
});
